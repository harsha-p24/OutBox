"use client";

import { useEffect, useState, useCallback } from "react";
import ComposeModal from "@/components/ComposeModal";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3000";

type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

type Email = {
  id: string;
  recipient: string;
  subject: string;
  body?: string;
  scheduledAt: string;
  sentAt: string | null;
  status: string;
  errorMessage?: string | null;
};

type Campaign = {
  id: string;
  subject: string;
  status?: string;
  emails: Email[];
};

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);

  const [campaigns, setCampaigns] =
    useState<Campaign[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [showCompose, setShowCompose] =
    useState(false);

  const [senderId, setSenderId] =
    useState<string>("");

  const [lastUpdated, setLastUpdated] =
    useState<Date | null>(null);

  /*
   * Load campaigns from PostgreSQL through
   * the backend API.
   */
  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/campaigns`,
        {
          credentials: "include",
          cache: "no-store",
        }
      );

      if (!res.ok) {
        console.error(
          "Failed to load campaigns:",
          res.status
        );
        return;
      }

      const data = await res.json();

      if (Array.isArray(data)) {
        setCampaigns(data);
      } else if (
        data &&
        Array.isArray(data.campaigns)
      ) {
        setCampaigns(data.campaigns);
      } else {
        setCampaigns([]);
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error(
        "Failed to load campaigns:",
        err
      );
    }
  }, []);

  /*
   * Initial dashboard load.
   */
  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch(
          `${API_URL}/auth/me`,
          {
            credentials: "include",
            cache: "no-store",
          }
        );

        const meData = await meRes.json();

        if (!meData.user) {
          window.location.href = "/";
          return;
        }

        setUser(meData.user);

        /*
         * Current sender used by the project.
         */
        setSenderId(
          "0ed4f1bb-11ea-4a8e-b0b4-bf2d896d8e79"
        );

        await loadCampaigns();
      } catch (err) {
        console.error(
          "Failed to load dashboard:",
          err
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [loadCampaigns]);

  /*
   * Refresh campaign/email status every 3 seconds.
   *
   * Worker updates PostgreSQL independently.
   * This keeps the dashboard synchronized with it.
   */
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      loadCampaigns();
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [user, loadCampaigns]);

  async function handleLogout() {
    try {
      await fetch(
        `${API_URL}/auth/logout`,
        {
          method: "POST",
          credentials: "include",
        }
      );
    } finally {
      window.location.href = "/";
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        Loading...
      </main>
    );
  }

  const allEmails = campaigns.flatMap(
    (campaign) =>
      campaign.emails.map((email) => ({
        ...email,
        campaignSubject:
          campaign.subject,
      }))
  );

  /*
   * Scheduled / currently processing emails.
   */
  const scheduled = allEmails.filter(
    (email) =>
      email.status === "SCHEDULED" ||
      email.status === "PROCESSING"
  );

  /*
   * Successfully sent emails.
   */
  const sent = allEmails.filter(
    (email) =>
      email.status === "SENT"
  );

  /*
   * Failed emails.
   */
  const failed = allEmails.filter(
    (email) =>
      email.status === "FAILED"
  );

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <h1 className="text-xl font-bold">
          OutBox
        </h1>

        <div className="flex items-center gap-3">
          {user?.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="h-8 w-8 rounded-full"
            />
          )}

          <div className="text-sm">
            <div className="font-medium">
              {user?.name}
            </div>

            <div className="text-gray-400">
              {user?.email}
            </div>
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
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() =>
              setShowCompose(true)
            }
            className="rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500"
          >
            + Compose New Email
          </button>

          <div className="text-xs text-gray-500">
            {lastUpdated
              ? `Last updated: ${lastUpdated.toLocaleTimeString()}`
              : "Updating..."}
          </div>
        </div>

        {/* Scheduled Emails */}
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">
            Scheduled Emails
          </h2>

          {scheduled.length === 0 ? (
            <p className="text-gray-500">
              No scheduled emails.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-gray-400">
                  <tr>
                    <th className="pb-2">
                      Email
                    </th>

                    <th className="pb-2">
                      Subject
                    </th>

                    <th className="pb-2">
                      Scheduled time
                    </th>

                    <th className="pb-2">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {scheduled.map(
                    (email) => (
                      <tr
                        key={email.id}
                        className="border-t border-gray-800"
                      >
                        <td className="py-3">
                          {email.recipient}
                        </td>

                        <td className="py-3">
                          {email.campaignSubject}
                        </td>

                        <td className="py-3 text-gray-400">
                          {new Date(
                            email.scheduledAt
                          ).toLocaleString()}
                        </td>

                        <td className="py-3">
                          <span className="rounded bg-yellow-900/40 px-2 py-1 text-xs text-yellow-400">
                            {email.status}
                          </span>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Sent Emails */}
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">
            Sent Emails
          </h2>

          {sent.length === 0 ? (
            <p className="text-gray-500">
              No sent emails.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-gray-400">
                  <tr>
                    <th className="pb-2">
                      Email
                    </th>

                    <th className="pb-2">
                      Subject
                    </th>

                    <th className="pb-2">
                      Sent time
                    </th>

                    <th className="pb-2">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {sent.map(
                    (email) => (
                      <tr
                        key={email.id}
                        className="border-t border-gray-800"
                      >
                        <td className="py-3">
                          {email.recipient}
                        </td>

                        <td className="py-3">
                          {email.campaignSubject}
                        </td>

                        <td className="py-3 text-gray-400">
                          {email.sentAt
                            ? new Date(
                                email.sentAt
                              ).toLocaleString()
                            : "-"}
                        </td>

                        <td className="py-3">
                          <span className="rounded bg-green-900/40 px-2 py-1 text-xs text-green-400">
                            SENT
                          </span>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Failed Emails */}
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">
            Failed Emails
          </h2>

          {failed.length === 0 ? (
            <p className="text-gray-500">
              No failed emails.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-gray-400">
                  <tr>
                    <th className="pb-2">
                      Email
                    </th>

                    <th className="pb-2">
                      Subject
                    </th>

                    <th className="pb-2">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {failed.map(
                    (email) => (
                      <tr
                        key={email.id}
                        className="border-t border-gray-800"
                      >
                        <td className="py-3">
                          {email.recipient}
                        </td>

                        <td className="py-3">
                          {email.campaignSubject}
                        </td>

                        <td className="py-3">
                          <span className="rounded bg-red-900/40 px-2 py-1 text-xs text-red-400">
                            FAILED
                          </span>

                          {email.errorMessage && (
                            <div className="mt-1 text-xs text-gray-500">
                              {email.errorMessage}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showCompose && (
        <ComposeModal
          senderId={senderId}
          userId={user?.id || ""}
          onClose={() =>
            setShowCompose(false)
          }
          onCreated={async () => {
            setShowCompose(false);
            await loadCampaigns();
          }}
        />
      )}
    </main>
  );
}
