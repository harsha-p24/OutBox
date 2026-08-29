"use client";

import { useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type Props = {
  userId: string;
  senderId: string;
  onClose: () => void;
  onCreated: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ComposeModal({
  userId,
  senderId: initialSenderId,
  onClose,
  onCreated,
}: Props) {
  const [senderId, setSenderId] =
    useState(initialSenderId);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState("");
  const [fileName, setFileName] = useState("");
  const [detectedCount, setDetectedCount] = useState(0);
  const [startTime, setStartTime] = useState("");
  const [delayMs, setDelayMs] = useState("2000");
  const [hourlyLimit, setHourlyLimit] = useState("100");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function parseEmails(text: string): string[] {
    return Array.from(
      new Set(
        text
          .split(/[\n,;]+/)
          .map((e) => e.trim())
          .filter((e) => EMAIL_RE.test(e))
      )
    );
  }

  function handleRecipientsChange(text: string) {
    setRecipients(text);
    setDetectedCount(parseEmails(text).length);
  }

  function handleFileUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();

    reader.onload = () => {
      const text = String(reader.result || "");
      handleRecipientsChange(text);
    };

    reader.readAsText(file);
  }

  async function createCampaign(
    e: React.FormEvent
  ) {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      const recipientList =
        parseEmails(recipients);

      if (!userId.trim()) {
        throw new Error(
          "User session not found. Please login again."
        );
      }

      if (!senderId.trim()) {
        throw new Error(
          "Sender ID is required."
        );
      }

      if (recipientList.length === 0) {
        throw new Error(
          "Add at least one valid recipient email."
        );
      }

      if (!subject.trim()) {
        throw new Error(
          "Email subject is required."
        );
      }

      if (!body.trim()) {
        throw new Error(
          "Email body is required."
        );
      }

      if (!startTime) {
        throw new Error(
          "Select a start time."
        );
      }

      const delayValue = Number(delayMs);
      const hourlyLimitValue =
        Number(hourlyLimit);

      if (
        !Number.isFinite(delayValue) ||
        delayValue < 1
      ) {
        throw new Error(
          "Delay must be at least 1 ms."
        );
      }

      if (
        !Number.isFinite(hourlyLimitValue) ||
        hourlyLimitValue < 1
      ) {
        throw new Error(
          "Hourly limit must be at least 1."
        );
      }

      /*
       * Send the logged-in user's ID to the backend.
       */
      const response = await fetch(
        `${API_URL}/campaigns`,
        {
          method: "POST",

          credentials: "include",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            userId,
            senderId,
            subject: subject.trim(),
            body: body.trim(),
            recipients: recipientList,

            startTime:
              new Date(
                startTime
              ).toISOString(),

            delayMs: delayValue,

            hourlyLimit:
              hourlyLimitValue,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to create campaign."
        );
      }

      /*
       * Campaign successfully created.
       */
      onCreated();
      onClose();
    } catch (err: any) {
      console.error(
        "Create campaign error:",
        err
      );

      setError(
        err?.message ||
          "Failed to create campaign."
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
            <h2 style={styles.title}>
              Create Campaign
            </h2>

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

        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}

        <form onSubmit={createCampaign}>
          <label style={styles.label}>
            Sender ID
          </label>

          <input
            value={senderId}
            onChange={(e) =>
              setSenderId(e.target.value)
            }
            placeholder="Enter sender ID"
            style={styles.input}
            required
          />

          <label style={styles.label}>
            Subject
          </label>

          <input
            value={subject}
            onChange={(e) =>
              setSubject(e.target.value)
            }
            placeholder="Email subject"
            required
            style={styles.input}
          />

          <label style={styles.label}>
            Email Body
          </label>

          <textarea
            value={body}
            onChange={(e) =>
              setBody(e.target.value)
            }
            placeholder="Write your email..."
            required
            rows={7}
            style={styles.textarea}
          />

          <label style={styles.label}>
            Upload leads (CSV or text file)
          </label>

          <input
            type="file"
            accept=".csv,.txt"
            onChange={handleFileUpload}
            style={styles.input}
          />

          {fileName && (
            <p style={styles.hint}>
              Loaded{" "}
              <strong>{fileName}</strong> —{" "}
              {detectedCount} valid email
              address
              {detectedCount === 1
                ? ""
                : "es"}{" "}
              detected.
            </p>
          )}

          <label style={styles.label}>
            Or paste recipients
          </label>

          <textarea
            value={recipients}
            onChange={(e) =>
              handleRecipientsChange(
                e.target.value
              )
            }
            placeholder={
              "one@example.com\ntwo@example.com\nthree@example.com"
            }
            rows={6}
            style={styles.textarea}
          />

          <p style={styles.hint}>
            {detectedCount} valid email
            address
            {detectedCount === 1
              ? ""
              : "es"}{" "}
            detected.
          </p>

          <div style={styles.grid}>
            <div>
              <label style={styles.label}>
                Start Time
              </label>

              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) =>
                  setStartTime(
                    e.target.value
                  )
                }
                required
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>
                Delay (ms)
              </label>

              <input
                type="number"
                min="1"
                value={delayMs}
                onChange={(e) =>
                  setDelayMs(
                    e.target.value
                  )
                }
                required
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>
                Hourly Limit
              </label>

              <input
                type="number"
                min="1"
                value={hourlyLimit}
                onChange={(e) =>
                  setHourlyLimit(
                    e.target.value
                  )
                }
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
              {loading
                ? "Creating..."
                : "Create Campaign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    zIndex: 1000,
  },

  modal: {
    width: "100%",
    maxWidth: "720px",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#fff",
    color: "#171717",
    borderRadius: "16px",
    padding: "28px",
    boxShadow:
      "0 20px 60px rgba(0,0,0,0.2)",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "22px",
  },

  title: {
    margin: 0,
    fontSize: "24px",
  },

  subtitle: {
    margin: "6px 0 0",
    color: "#737373",
    fontSize: "14px",
  },

  close: {
    border: "none",
    background: "transparent",
    fontSize: "28px",
    cursor: "pointer",
    lineHeight: 1,
  },

  label: {
    display: "block",
    fontSize: "13px",
    fontWeight: 600,
    marginBottom: "7px",
    marginTop: "16px",
    color: "#171717",
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #d4d4d4",
    borderRadius: "8px",
    padding: "11px 12px",
    fontSize: "14px",
    outline: "none",
    color: "#171717",
    background: "#ffffff",
  },

  textarea: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #d4d4d4",
    borderRadius: "8px",
    padding: "11px 12px",
    fontSize: "14px",
    resize: "vertical",
    fontFamily:
      "Arial, Helvetica, sans-serif",
    outline: "none",
    color: "#171717",
    background: "#ffffff",
  },

  hint: {
    margin: "6px 0 0",
    color: "#737373",
    fontSize: "12px",
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(3, minmax(0, 1fr))",
    gap: "12px",
  },

  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "25px",
    paddingTop: "20px",
    borderTop:
      "1px solid #e5e5e5",
  },

  cancel: {
    border:
      "1px solid #d4d4d4",
    background: "#fff",
    padding: "10px 17px",
    borderRadius: "8px",
    cursor: "pointer",
  },

  submit: {
    border: "none",
    background: "#111",
    color: "#fff",
    padding: "10px 18px",
    borderRadius: "8px",
    cursor: "pointer",
  },

  error: {
    background: "#fee2e2",
    color: "#991b1b",
    padding: "11px",
    borderRadius: "8px",
    fontSize: "13px",
    marginBottom: "15px",
  },
};
