"use client";

import { useEffect, useRef, useState } from "react";
import type { DataConnection } from "peerjs";

export default function Home() {
  const [myId, setMyId] = useState("");
  const [remoteId, setRemoteId] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const connRef = useRef<DataConnection | null>(null);
  const peerRef = useRef<import("peerjs").default | null>(null);

  useEffect(() => {
    import("peerjs").then(({ default: Peer }) => {
      const peer = new Peer();
      peerRef.current = peer;

      peer.on("open", (id) => setMyId(id));

      
      peer.on("connection", (conn) => {
        connRef.current = conn;
        conn.on("data", (data) => {
          setMessages((prev) => [...prev, `them: ${data}`]);
        });
      });
    });
  }, []);

  function connect() {
    const conn = peerRef.current!.connect(remoteId);
    connRef.current = conn;
    conn.on("data", (data) => {
      setMessages((prev) => [...prev, `them: ${data}`]);
    });
  }

  function send() {
    connRef.current?.send(draft);
    setMessages((prev) => [...prev, `me: ${draft}`]);
    setDraft("");
  }

  return (
    <div>
      <p>Your ID: {myId}</p>

      <input value={remoteId} onChange={(e) => setRemoteId(e.target.value)} placeholder="peer id" />
      <button onClick={connect}>Connect</button>

      <div>
        {messages.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>

      <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={send}>Send</button>
    </div>
  );
}