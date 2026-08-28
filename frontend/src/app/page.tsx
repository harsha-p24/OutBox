"use client";

import { useEffect, useState } from "react";

type Email = {
  id: string;
  recipient: string;
  status: "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED";
  scheduledAt: string;
  sentAt: string | null;
  errorMessage: string | null;
};

type Campaign = {
  id: string;
  subject: string;
  body: string;
  status: "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED";
  startTime: string;
  emails: Email[];
};

type Stats = {
  total: number;
  scheduled: number;
  processing: number;
  sent: number;
  failed: number;
  completed: number;
  progress: number;
  campaignStatus: string;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function Home() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadCampaigns() {
    try {
      setError("");

      const response = await fetch(`${API_URL}/campaigns`, {
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load campaigns");
      }

      setCampaigns(data.campaigns || []);

      const statsEntries = await Promise.all(
        (data.campaigns || []).map(async (campaign: Campaign) => {
          const statsResponse = await fetch(
            `${API_URL}/campaigns/${campaign.id}/stats`,
            {
              credentials: "include",
            }
          );

          const statsData = await statsResponse.json();

          return [
            campaign.id,
            statsData.stats,
          ] as [string, Stats];
        })
      );

      setStats(Object.fromEntries(statsEntries));
    } catch (err: any) {
      setError(err?.message || "Unable to load campaigns");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCampaigns();

    const timer = setInterval(loadCampaigns, 5000);

    return () => clearInterval(timer);
  }, []);

  async function campaignAction(
    id: string,
    action: "pause" | "resume" | "cancel"
  ) {
    try {
      const response = await fetch(
        `${API_URL}/campaigns/${id}/${action}`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} campaign`);
      }

      await loadCampaigns();
    } catch (err: any) {
      alert(err?.message || `Failed to ${action} campaign`);
    }
  }

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.center}>
          Loading OutBox...
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.logo}>OutBox</h1>
          <p style={styles.subtitle}>
            Email campaign management
          </p>
        </div>

        <button
          style={styles.refreshButton}
          onClick={loadCampaigns}
        >
          Refresh
        </button>
      </header>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      <section style={styles.summary}>
        <div style={styles.summaryCard}>
          <span>Total Campaigns</span>
          <strong>{campaigns.length}</strong>
        </div>

        <div style={styles.summaryCard}>
          <span>Running</span>
          <strong>
            {campaigns.filter(
              (c) => c.status === "RUNNING"
            ).length}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span>Completed</span>
          <strong>
            {campaigns.filter(
              (c) => c.status === "COMPLETED"
            ).length}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span>Failed</span>
          <strong>
            {campaigns.filter(
              (c) => c.status === "FAILED"
            ).length}
          </strong>
        </div>
      </section>

      <section>
        <div style={styles.sectionHeader}>
          <h2>Campaigns</h2>
          <span>{campaigns.length} campaigns</span>
        </div>

        {campaigns.length === 0 ? (
          <div style={styles.empty}>
            <h3>No campaigns yet</h3>
            <p>
              Create your first email campaign to see it here.
            </p>
          </div>
        ) : (
          <div style={styles.list}>
            {campaigns.map((campaign) => {
              const campaignStats = stats[campaign.id];

              return (
                <article
                  key={campaign.id}
                  style={styles.card}
                >
                  <div style={styles.cardTop}>
                    <div>
                      <h3 style={styles.subject}>
                        {campaign.subject}
                      </h3>

                      <p style={styles.date}>
                        Starts{" "}
                        {new Date(
                          campaign.startTime
                        ).toLocaleString()}
                      </p>
                    </div>

                    <span
                      style={{
                        ...styles.status,
                        ...statusStyle(campaign.status),
                      }}
                    >
                      {campaign.status}
                    </span>
                  </div>

                  <div style={styles.progressArea}>
                    <div style={styles.progressHeader}>
                      <span>Progress</span>
                      <strong>
                        {campaignStats?.progress ?? 0}%
                      </strong>
                    </div>

                    <div style={styles.progressTrack}>
                      <div
                        style={{
                          ...styles.progressBar,
                          width: `${
                            campaignStats?.progress ?? 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  <div style={styles.statsGrid}>
                    <Stat
                      label="Total"
                      value={campaignStats?.total ?? 0}
                    />
                    <Stat
                      label="Scheduled"
                      value={campaignStats?.scheduled ?? 0}
                    />
                    <Stat
                      label="Processing"
                      value={campaignStats?.processing ?? 0}
                    />
                    <Stat
                      label="Sent"
                      value={campaignStats?.sent ?? 0}
                    />
                    <Stat
                      label="Failed"
                      value={campaignStats?.failed ?? 0}
                    />
                  </div>

                  <div style={styles.actions}>
                    {campaign.status === "RUNNING" && (
                      <button
                        style={styles.secondaryButton}
                        onClick={() =>
                          campaignAction(
                            campaign.id,
                            "pause"
                          )
                        }
                      >
                        Pause
                      </button>
                    )}

                    {campaign.status === "SCHEDULED" && (
                      <button
                        style={styles.secondaryButton}
                        onClick={() =>
                          campaignAction(
                            campaign.id,
                            "pause"
                          )
                        }
                      >
                        Pause
                      </button>
                    )}

                    {campaign.status === "DRAFT" && (
                      <button
                        style={styles.secondaryButton}
                        onClick={() =>
                          campaignAction(
                            campaign.id,
                            "resume"
                          )
                        }
                      >
                        Start
                      </button>
                    )}

                    {campaign.status === "RUNNING" ||
                    campaign.status === "SCHEDULED" ? (
                      <button
                        style={styles.secondaryButton}
                        onClick={() =>
                          campaignAction(
                            campaign.id,
                            "cancel"
                          )
                        }
                      >
                        Cancel
                      </button>
                    ) : null}

                    {campaign.status === "DRAFT" ? (
                      <button
                        style={styles.secondaryButton}
                        onClick={() =>
                          campaignAction(
                            campaign.id,
                            "resume"
                          )
                        }
                      >
                        Resume
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div style={styles.stat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function statusStyle(status: string) {
  switch (status) {
    case "RUNNING":
      return styles.running;

    case "COMPLETED":
      return styles.completed;

    case "FAILED":
      return styles.failed;

    case "SCHEDULED":
      return styles.scheduled;

    case "DRAFT":
      return styles.draft;

    default:
      return {};
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f6f7f9",
    padding: "40px",
    fontFamily:
      "Arial, Helvetica, sans-serif",
    color: "#171717",
  },

  header: {
    maxWidth: "1100px",
    margin: "0 auto 30px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  logo: {
    margin: 0,
    fontSize: "34px",
  },

  subtitle: {
    margin: "5px 0 0",
    color: "#777",
  },

  refreshButton: {
    border: "none",
    background: "#111",
    color: "#fff",
    padding: "11px 18px",
    borderRadius: "8px",
    cursor: "pointer",
  },

  summary: {
    maxWidth: "1100px",
    margin: "0 auto 35px",
    display: "grid",
    gridTemplateColumns:
      "repeat(4, minmax(0, 1fr))",
    gap: "15px",
  },

  summaryCard: {
    background: "#fff",
    border: "1px solid #e5e5e5",
    borderRadius: "12px",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },

  center: {
    minHeight: "80vh",
    display: "grid",
    placeItems: "center",
    fontSize: "20px",
  },

  error: {
    maxWidth: "1100px",
    margin: "0 auto 20px",
    background: "#fee2e2",
    color: "#991b1b",
    padding: "14px",
    borderRadius: "8px",
  },

  sectionHeader: {
    maxWidth: "1100px",
    margin: "0 auto 15px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  list: {
    maxWidth: "1100px",
    margin: "0 auto",
    display: "grid",
    gap: "18px",
  },

  card: {
    background: "#fff",
    border: "1px solid #e5e5e5",
    borderRadius: "14px",
    padding: "24px",
  },

  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "20px",
  },

  subject: {
    margin: 0,
    fontSize: "20px",
  },

  date: {
    color: "#777",
    fontSize: "13px",
  },

  status: {
    padding: "6px 11px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: 700,
  },

  running: {
    background: "#dcfce7",
    color: "#166534",
  },

  completed: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },

  failed: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  scheduled: {
    background: "#fef3c7",
    color: "#92400e",
  },

  draft: {
    background: "#e5e7eb",
    color: "#374151",
  },

  progressArea: {
    marginTop: "25px",
  },

  progressHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "8px",
    fontSize: "13px",
  },

  progressTrack: {
    height: "9px",
    background: "#e5e7eb",
    borderRadius: "10px",
    overflow: "hidden",
  },

  progressBar: {
    height: "100%",
    background: "#111",
    borderRadius: "10px",
    transition: "width 0.3s ease",
  },

  statsGrid: {
    marginTop: "22px",
    display: "grid",
    gridTemplateColumns:
      "repeat(5, minmax(0, 1fr))",
    gap: "10px",
  },

  stat: {
    background: "#f7f7f7",
    padding: "13px",
    borderRadius: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "5px",
  },

  actions: {
    marginTop: "22px",
    display: "flex",
    gap: "10px",
  },

  secondaryButton: {
    border: "1px solid #d4d4d4",
    background: "#fff",
    padding: "9px 15px",
    borderRadius: "7px",
    cursor: "pointer",
  },

  empty: {
    maxWidth: "1100px",
    margin: "0 auto",
    background: "#fff",
    border: "1px solid #e5e5e5",
    borderRadius: "14px",
    padding: "50px",
    textAlign: "center",
  },
};
