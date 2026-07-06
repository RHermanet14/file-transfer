"use client";

import { useEffect, useRef, useState } from "react";
import type { DataConnection } from "peerjs";

export default function PeerChatDebug() {
  const [myId, setMyId] = useState("");
  const [remoteId, setRemoteId] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [receivedFileUrl, setReceivedFileUrl] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const connRef = useRef<DataConnection | null>(null);
  const peerRef = useRef<import("peerjs").default | null>(null);

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
          connRef.current = conn;

          conn.on("open", () => addLog("Incoming connection is now OPEN"));
          conn.on("data", (data) => {
            addLog(`Received data (type: ${data instanceof ArrayBuffer ? "ArrayBuffer" : typeof data})`);
            handleData(data);
          });
          conn.on("close", () => addLog("Incoming connection closed"));
          conn.on("error", (err) => addLog(`Incoming connection error: ${err}`));
        });

        peer.on("error", (err) => {
          addLog(`PEER ERROR (type: ${err.type}): ${err.message}`);
        });

        peer.on("disconnected", () => {
          addLog("Peer disconnected from signaling server");
        });

        peer.on("close", () => {
          addLog("Peer connection fully closed");
        });
      })
      .catch((err) => {
        addLog(`FAILED to load peerjs module: ${err}`);
      });
  }, []);

  function handleData(data: unknown) {
    if (data instanceof ArrayBuffer) {
      const blob = new Blob([data]);
      setReceivedFileUrl(URL.createObjectURL(blob));
    } else {
      setMessages((prev) => [...prev, `them: ${data}`]);
    }
  }

  function connect() {
    if (!peerRef.current) {
      addLog("Cannot connect: peer object not ready yet");
      return;
    }
    if (!remoteId) {
      addLog("Cannot connect: no remote ID entered");
      return;
    }

    addLog(`Attempting to connect to: ${remoteId}`);
    const conn = peerRef.current.connect(remoteId, { reliable: true });
    connRef.current = conn;

    conn.on("open", () => addLog("Outgoing connection is now OPEN"));
    conn.on("data", (data) => {
      addLog(`Received data (type: ${data instanceof ArrayBuffer ? "ArrayBuffer" : typeof data})`);
      handleData(data);
    });
    conn.on("close", () => addLog("Outgoing connection closed"));
    conn.on("error", (err) => addLog(`Outgoing connection error: ${err}`));
  }

  function send() {
    if (!connRef.current) {
      addLog("Cannot send: no active connection");
      return;
    }
    if (!connRef.current.open) {
      addLog("Cannot send: connection exists but is not open yet");
      return;
    }
    addLog(`Sending message: "${draft}"`);
    connRef.current.send(draft);
    setMessages((prev) => [...prev, `me: ${draft}`]);
    setDraft("");
  }

  async function sendFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!connRef.current || !connRef.current.open) {
      addLog("Cannot send file: no open connection");
      return;
    }
    addLog(`Sending file: ${file.name} (${file.size} bytes)`);
    const buffer = await file.arrayBuffer();
    connRef.current.send(buffer);
    addLog("File sent");
  }

  return (
    <div style={{ fontFamily: "monospace", fontSize: 13 }}>
      <p>Your ID: {myId || "(waiting for open event...)"}</p>

      <input value={remoteId} onChange={(e) => setRemoteId(e.target.value)} placeholder="peer id" />
      <button onClick={connect}>Connect</button>

      <div>
        {messages.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>

      <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={send}>Send</button>

      <div>
        <input type="file" onChange={sendFile} />
      </div>

      {receivedFileUrl && <a href={receivedFileUrl}>Download received file</a>}

      <hr />
      <h4>Debug log</h4>
      <div style={{ background: "#111", color: "#0f0", padding: 10, height: 220, overflowY: "auto" }}>
        {log.map((entry, i) => (
          <div key={i}>{entry}</div>
        ))}
      </div>
    </div>
  );
}