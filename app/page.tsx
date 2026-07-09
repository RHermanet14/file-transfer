"use client";

import { useEffect, useRef, useState } from "react";
import type { DataConnection } from "peerjs";

const CHUNK_SIZE = 64 * 1024; // 64KB per chunk

type IncomingMeta = {
  type: "meta";
  name: string;
  size: number;
  mime: string;
};

type IncomingDone = {
  type: "done";
};

export default function PeerChatDebug() {
  const [myId, setMyId] = useState("");
  const [remoteId, setRemoteId] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [receivedFile, setReceivedFile] = useState<{ url: string; name: string } | null>(null);
  const [sendProgress, setSendProgress] = useState<number | null>(null);
  const [receiveProgress, setReceiveProgress] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const connRef = useRef<DataConnection | null>(null);
  const peerRef = useRef<import("peerjs").default | null>(null);

  // Buffers used to reassemble an incoming file across many chunk messages
  const incomingChunks = useRef<ArrayBuffer[]>([]);
  const incomingMeta = useRef<IncomingMeta | null>(null);
  const incomingReceivedBytes = useRef<number>(0);

  function addLog(msg: string) {
    console.log("[peer-debug]", msg);
    queueMicrotask(() => {
      setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);
    });
  }

  useEffect(() => {
    addLog("Loading peerjs module...");

    import("peerjs")
      .then(({ default: Peer }) => {
        addLog("peerjs module loaded. Creating Peer()...");
        const peer = new Peer();
        peerRef.current = peer;

        peer.on("open", (id) => {
          addLog(`Peer opened successfully. My ID: ${id}`);
          setMyId(id);
        });

        peer.on("connection", (conn) => {
          addLog(`Incoming connection from: ${conn.peer}`);
          setupConnection(conn);
        });

        peer.on("error", (err) => addLog(`PEER ERROR (type: ${err.type}): ${err.message}`));
        peer.on("disconnected", () => addLog("Peer disconnected from signaling server"));
        peer.on("close", () => addLog("Peer connection fully closed"));
      })
      .catch((err) => addLog(`FAILED to load peerjs module: ${err}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared setup for both outgoing (we called .connect) and incoming
  // (they called .connect on us) connections.
  function setupConnection(conn: DataConnection) {
    connRef.current = conn;

    conn.on("open", () => addLog("Connection is now OPEN"));
    conn.on("close", () => addLog("Connection closed"));
    conn.on("error", (err) => addLog(`Connection error: ${err}`));

    conn.on("data", (data) => {
      // Everything that arrives is one of three things:
      // 1. An ArrayBuffer -> a chunk of file bytes
      // 2. {type: "meta", ...} -> "a file is coming, here's its name/size"
      // 3. {type: "done"} -> "that was the last chunk, reassemble it"
      // Anything else (a plain string) is a regular chat message.
      if (data instanceof ArrayBuffer) {
        handleIncomingChunk(data);
        return;
      }

      const msg = data as IncomingMeta | IncomingDone | string;

      if (typeof msg === "string") {
        addLog(`Received text message`);
        setMessages((prev) => [...prev, `them: ${msg}`]);
        return;
      }

      if (msg.type === "meta") {
        addLog(`Incoming file starting: "${msg.name}" (${msg.size} bytes)`);
        incomingMeta.current = msg;
        incomingChunks.current = [];
        incomingReceivedBytes.current = 0;
        setReceiveProgress(0);
      }

      if (msg.type === "done") {
        addLog("Incoming file complete, reassembling...");
        finishIncomingFile();
      }
    });
  }

  function handleIncomingChunk(chunk: ArrayBuffer) {
    incomingChunks.current.push(chunk);
    incomingReceivedBytes.current += chunk.byteLength;

    if (incomingMeta.current) {
      const pct = Math.min(
        100,
        Math.round((incomingReceivedBytes.current / incomingMeta.current.size) * 100)
      );
      setReceiveProgress(pct);
    }
  }

  function finishIncomingFile() {
    if (!incomingMeta.current) {
      addLog("Got a 'done' message but no meta was seen first — ignoring");
      return;
    }

    const blob = new Blob(incomingChunks.current, { type: incomingMeta.current.mime });
    const url = URL.createObjectURL(blob);

    setReceivedFile({ url, name: incomingMeta.current.name });
    setReceiveProgress(null);
    addLog(`File ready: ${incomingMeta.current.name}`);

    incomingMeta.current = null;
    incomingChunks.current = [];
    incomingReceivedBytes.current = 0;
  }

  function connect() {
    if (!peerRef.current) return addLog("Cannot connect: peer object not ready yet");
    if (!remoteId) return addLog("Cannot connect: no remote ID entered");

    addLog(`Attempting to connect to: ${remoteId}`);
    const conn = peerRef.current.connect(remoteId, { reliable: true });
    setupConnection(conn);
  }

  function send() {
    if (!connRef.current?.open) return addLog("Cannot send: connection not open");
    addLog(`Sending message: "${draft}"`);
    connRef.current.send(draft);
    setMessages((prev) => [...prev, `me: ${draft}`]);
    setDraft("");
  }

  // The chunking loop: read the whole file, then send it piece by piece
  // instead of as one giant message.
  async function sendFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const conn = connRef.current;
    if (!file) return;
    setSelectedFileName(file.name);
    if (!conn?.open) return addLog("Cannot send file: no open connection");

    addLog(`Starting send: "${file.name}" (${file.size} bytes)`);

    // 1. Tell the other side what's coming, before any bytes arrive.
    conn.send({
      type: "meta",
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
    } satisfies IncomingMeta);

    // 2. Read the whole file into memory as raw bytes, then slice it up.
    const buffer = await file.arrayBuffer();
    let offset = 0;

    while (offset < buffer.byteLength) {
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
      conn.send(chunk);
      offset += CHUNK_SIZE;

      const pct = Math.min(100, Math.round((offset / buffer.byteLength) * 100));
      setSendProgress(pct);

      // Yield to the browser between chunks so the UI doesn't freeze and
      // PeerJS's internal send buffer doesn't pile up unbounded.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // 3. Tell the other side there's nothing more coming.
    conn.send({ type: "done" } satisfies IncomingDone);
    addLog(`Finished sending "${file.name}"`);
    setSendProgress(null);
    e.target.value = "";
  }

  const draftKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter')
      send();
  };

  const [isChecked, setIsChecked] = useState<boolean>(false);

  const handleCheck = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsChecked(event.target.checked);
  }

  return (
    <div className="font-mono text-sm space-y-4">
      <div className="flex">
        <p>Your ID:</p>
        <button className="text-gray-700 font-semibold px-2 rounded bg-gray-400 hover:bg-gray-300" onClick={() => navigator.clipboard.writeText(myId)}>{myId || "(waiting for open event...)"}</button>
      </div>
      

      <div className="flex gap-2">
        <input value={remoteId} onChange={(e) => setRemoteId(e.target.value)} placeholder="Peer ID" className="flex-1 border border-gray-300 rounded px-2 py-1"/>
        <button onClick={connect} className="bg-gray-600 text-white rounded px-3 py-1 hover:bg-gray-500">Connect</button>
      </div>
      
      <div className="flex gap-2">
        <input placeholder="Your message here" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={draftKeyDown} className="flex-1 border border-gray-300 rounded px-2 py-1"/>
        <button onClick={send} className="bg-gray-600 text-white rounded px-3 py-1 hover:bg-gray-500">Send</button>
      </div>

      <div className="flex items-center gap-6">
        <label className="cursor-pointer bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 transition-colors">
          Choose file
          <input type="file" onChange={sendFile} className="hidden" />
        </label>

        <span className="text-gray-500 italic">
          {selectedFileName ?? "No file selected"}
        </span>

        {sendProgress !== null && (
          <span className="text-blue-600 font-semibold">{sendProgress}%</span>
        )}
      </div>
 
      {receiveProgress !== null && (
        <p className="text-blue-600">receiving... {receiveProgress}%</p>
      )}

      {receivedFile && (
        <p>
          <a
            href={receivedFile.url}
            download={receivedFile.name}
            className="text-green-700 underline hover:text-green-900"
          >
            Download {receivedFile.name}
          </a>
        </p>
      )}

      <hr className="border-gray-300" />

      <div className="space-y-1 overflow-y-auto">
        {messages.toReversed().map((m, i) => (
          <div className="text-gray-800" key={i}>{m}</div>
        ))}
      </div>
 
      <hr className="border-gray-300" />

      <div className="flex gap-4 p-2">
        <h4>Debug log</h4>
        <input type="checkbox" checked={isChecked} onChange={handleCheck}/>
      </div>
      {
        isChecked ?
        <div className="bg-neutral-900 text-green-400 p-2.5 h-220 overflow-y-auto">
          {log.map((entry, i) => (
            <div key={i}>{entry}</div>
          ))}
        </div>
        : null
      }
      
    </div>
  );
}