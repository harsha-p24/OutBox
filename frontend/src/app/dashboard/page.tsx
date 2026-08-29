"use client";

import { useEffect, useState } from "react";
import ComposeModal from "@/components/ComposeModal";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

type Sender = {
  id: string;
  email: string;
};

type Email = {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: string;
};

type Campaign = {
  id: string;
  subject: string;
  emails: Email[];
};

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [senderId, setSenderId] = useState<string>("");

  async function loadCampaigns() {
    const res = await fetch(`${API_URL}/campaigns`, { credentials: "include" });
    const data = await res.json();
    setCampaigns(data.campaigns || []);
  }

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
        const meData = await meRes.json();

        if (!meData.user) {
          window.location.href = "/";
          return;
        }
        setUser(meData.user);
        // TEMP: hardcoded sender until a real "Senders" management UI exists
        setSenderId("0ed4f1bb-11ea-4a8e-b0b4-bf2d896d8e79");

        await loadCampaigns();
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleLogout() {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    window.location.href = "/";
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        Loading...
      </main>
    );
  }

  const allEmails = campaigns.flatMap((c) =>
    c.emails.map((e) => ({ ...e, campaignSubject: c.subject }))
  );
  const scheduled = allEmails.filter((e) => e.status === "SCHEDULED" || e.status === "PROCESSING");
  const sent = allEmails.filter((e) => e.status === "SENT" || e.status === "FAILED");

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <h1 className="text-xl font-bold">OutBox</h1>
        <div className="flex items-center gap-3">
          {user?.avatarUrl && (
            <img src={user.avatarUrl} alt={user.name} className="h-8 w-8 rounded-full" />
          )}
          <div className="text-sm">
            <div className="font-medium">{user?.name}</div>
            <div className="text-gray-400">{user?.email}</div>
          </div>
          
          
          <a
            href={`${API_URL}/slack/connect`}
            className="ml-4 rounded bg-purple-700 px-3 py-1.5 text-sm hover:bg-purple-600"
          >
            Connect Slack
          </a>
          <button
            onClick={handleLogout}
            className="ml-4 rounded bg-gray-800 px-3 py-1.5 text-sm hover:bg-gray-700"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="p-6">
        <button
          onClick={() => setShowCompose(true)}
          className="mb-6 rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500"
        >
          + Compose New Email
        </button>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Scheduled Emails</h2>
          {scheduled.length === 0 ? (
            <p className="text-gray-500">No scheduled emails.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th className="pb-2">Email</th>
                  <th className="pb-2">Subject</th>
                  <th className="pb-2">Scheduled time</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {scheduled.map((e) => (
                  <tr key={e.id} className="border-t border-gray-800">
                    <td className="py-2">{e.recipient}</td>
                    <td className="py-2">{e.subject}</td>
                    <td className="py-2">{new Date(e.scheduledAt).toLocaleString()}</td>
                    <td className="py-2">
                      <span className="rounded bg-yellow-900 px-2 py-0.5 text-xs text-yellow-300">
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Sent Emails</h2>
          {sent.length === 0 ? (
            <p className="text-gray-500">No sent emails.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th className="pb-2">Email</th>
                  <th className="pb-2">Subject</th>
                  <th className="pb-2">Sent time</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {sent.map((e) => (
                  <tr key={e.id} className="border-t border-gray-800">
                    <td className="py-2">{e.recipient}</td>
                    <td className="py-2">{e.subject}</td>
                    <td className="py-2">
                      {e.sentAt ? new Date(e.sentAt).toLocaleString() : "-"}
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          e.status === "SENT"
                            ? "bg-green-900 text-green-300"
                            : "bg-red-900 text-red-300"
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {showCompose && (
        <ComposeModal
          senderId={senderId}
          onClose={() => setShowCompose(false)}
          onCreated={loadCampaigns}
        />
      )}
    </main>
  );
}
