"use client";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  return (
    <div>
      <h1 className="">Transfer Files</h1>
      <div className="flex">
        <button className="bg-blue-600" onClick={() => router.push("/send")}>
          Send Files
        </button>
        <button className="bg-red-600" onClick={() => router.push("/receive")}>
          Receive Files
        </button>
      </div>
    </div>
  );
}
