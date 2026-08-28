"use client";

import { useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type Props = {
  senderId: string;
  onClose: () => void;
  onCreated: () => void;
};

export default function ComposeModal({
  senderId,
  onClose,
  onCreated,
}: Props) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState("");
  const [startTime, setStartTime] = useState("");
  const [delayMs, setDelayMs] = useState("2000");
  const [hourlyLimit, setHourlyLimit] = useState("100");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      if (!senderId.trim()) {
        throw new Error("Sender ID is not available.");
      }

      const recipientList = recipients
        .split(/[\n,]+/)
        .map((email) => email.trim())
        .filter(Boolean);

      if (recipientList.length === 0) {
        throw new Error("Add at least one recipient.");
      }

      if (!subject.trim()) {
        throw new Error("Subject is required.");
      }

      if (!body.trim()) {
        throw new Error("Email body is required.");
      }

      if (!startTime) {
        throw new Error("Select a start time.");
      }

      const delay = Number(delayMs);
      const limit = Number(hourlyLimit);

      if (!Number.isFinite(delay) || delay < 1) {
        throw new Error("Delay must be at least 1 ms.");
      }

      if (!Number.isFinite(limit) || limit < 1) {
        throw new Error("Hourly limit must be at least 1.");
      }

      const response = await fetch(`${API_URL}/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          senderId,
          subject: subject.trim(),
          body: body.trim(),
          recipients: recipientList,
          startTime: new Date(startTime).toISOString(),
          delayMs: delay,
          hourlyLimit: limit,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to create campaign."
        );
      }

      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create campaign."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Create Campaign</h2>

            <p style={styles.subtitle}>
              Schedule and send an email campaign.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={styles.close}
            disabled={loading}
          >
            ×
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={createCampaign}>
          <label style={styles.label}>Sender ID</label>

          <input
            value={senderId}
            readOnly
            style={{
              ...styles.input,
              backgroundColor: "#f3f4f6",
              color: "#6b7280",
            }}
          />

          <label style={styles.label}>Subject</label>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject"
            required
            style={styles.input}
          />

          <label style={styles.label}>Email Body</label>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your email..."
            required
            rows={7}
            style={styles.textarea}
          />

          <label style={styles.label}>Recipients</label>

          <textarea
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder={
              "one@example.com\n" +
              "two@example.com\n" +
              "three@example.com"
            }
            rows={6}
            style={styles.textarea}
          />

          <p style={styles.hint}>
            Enter one email per line or separate emails with commas.
          </p>

          <div style={styles.grid}>
            <div>
              <label style={styles.label}>Start Time</label>

              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Delay (ms)</label>

              <input
                type="number"
                min="1"
                value={delayMs}
                onChange={(e) => setDelayMs(e.target.value)}
                required
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Hourly Limit</label>

              <input
                type="number"
                min="1"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(e.target.value)}
                required
                style={styles.input}
              />
            </div>
          </div>

          <div style={styles.footer}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancel}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              style={styles.submit}
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Campaign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    zIndex: 50,
  },

  modal: {
    width: "100%",
    maxWidth: "700px",
    maxHeight: "90vh",
    overflowY: "auto",
    backgroundColor: "#ffffff",
    color: "#111827",
    borderRadius: "12px",
    padding: "24px",
    boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "20px",
  },

  title: {
    margin: 0,
    fontSize: "22px",
    fontWeight: 700,
  },

  subtitle: {
    marginTop: "6px",
    color: "#6b7280",
    fontSize: "14px",
  },

  close: {
    border: "none",
    background: "transparent",
    fontSize: "28px",
    cursor: "pointer",
    color: "#6b7280",
  },

  error: {
    marginBottom: "16px",
    padding: "10px 12px",
    borderRadius: "8px",
    backgroundColor: "#fee2e2",
    color: "#b91c1c",
    fontSize: "14px",
  },

  label: {
    display: "block",
    marginBottom: "6px",
    marginTop: "14px",
    fontSize: "14px",
    fontWeight: 600,
  },

  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    outline: "none",
    fontSize: "14px",
    boxSizing: "border-box",
  },

  textarea: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    outline: "none",
    fontSize: "14px",
    resize: "vertical",
    boxSizing: "border-box",
  },

  hint: {
    marginTop: "6px",
    color: "#6b7280",
    fontSize: "12px",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
  },

  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "24px",
  },

  cancel: {
    padding: "10px 16px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    backgroundColor: "#ffffff",
    cursor: "pointer",
  },

  submit: {
    padding: "10px 18px",
    border: "none",
    borderRadius: "8px",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 600,
  },
};
