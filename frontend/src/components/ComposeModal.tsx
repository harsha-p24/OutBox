"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type Props = {
  senderId: string;
  onClose: () => void;
  onCreated: () => void;
};

export default function ComposeModal({ senderId, onClose, onCreated }: Props) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [delayMs, setDelayMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function extractEmails(text: string): string[] {
    const matches = text.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    );

    return [...new Set(matches || [])];
  }

  async function handleFileUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) return;

    setFileName(file.name);
    setRecipients([]);
    setError("");

    try {
      const extension = file.name.toLowerCase().split(".").pop();

      // CSV / TXT
      if (extension === "csv" || extension === "txt") {
        const text = await file.text();
        const emails = extractEmails(text);

        setRecipients(emails);

        if (emails.length === 0) {
          setError("No valid email addresses found in the file.");
        }

        return;
      }

      // Excel XLSX / XLS
      if (extension === "xlsx" || extension === "xls") {
        const buffer = await file.arrayBuffer();

        const workbook = XLSX.read(buffer, {
          type: "array",
        });

        const allEmails: string[] = [];

        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];

          const rows = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            raw: false,
          }) as unknown[][];

          rows.forEach((row) => {
            row.forEach((cell) => {
              if (typeof cell === "string") {
                const emails = extractEmails(cell);
                allEmails.push(...emails);
              }
            });
          });
        });

        const uniqueEmails = [...new Set(allEmails)];

        setRecipients(uniqueEmails);

        if (uniqueEmails.length === 0) {
          setError("No valid email addresses found in the Excel file.");
        }

        return;
      }

      setError("Please upload a CSV, TXT, XLS, or XLSX file.");
    } catch (err) {
      console.error("Failed to read recipient file:", err);
      setError("Could not read the recipient file.");
    }
  }

  async function handleSubmit() {
    setError("");

    if (!subject || !body || recipients.length === 0 || !startTime) {
      setError(
        "Please fill in subject, body, upload recipients, and set a start time."
      );
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`${API_URL}/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          senderId,
          subject,
          body,
          recipients,
          startTime: new Date(startTime).toISOString(),
          delayMs,
          hourlyLimit,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(
          data.error?.formErrors?.join(", ") ||
            data.error ||
            "Failed to schedule campaign."
        );
        return;
      }

      onCreated();
      onClose();
    } catch (err) {
      console.error("Schedule error:", err);
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg bg-gray-900 p-6 text-white">
        <h2 className="mb-4 text-lg font-semibold">
          Compose New Email
        </h2>

        {error && (
          <div className="mb-3 rounded bg-red-900/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-gray-400">
              Subject
            </label>

            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded bg-gray-800 px-3 py-2 text-sm outline-none"
              placeholder="Email subject"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">
              Body
            </label>

            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded bg-gray-800 px-3 py-2 text-sm outline-none"
              placeholder="Email body (HTML supported)"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">
              Recipients (Excel, CSV or TXT)
            </label>

            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              onChange={handleFileUpload}
              className="text-sm"
            />

            {fileName && (
              <p className="mt-1 text-xs text-gray-500">
                {fileName} — {recipients.length} email
                {recipients.length !== 1 ? "s" : ""} detected
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">
                Start time
              </label>

              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded bg-gray-800 px-2 py-2 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-gray-400">
                Delay (ms)
              </label>

              <input
                type="number"
                min="1"
                value={delayMs}
                onChange={(e) =>
                  setDelayMs(Number(e.target.value))
                }
                className="w-full rounded bg-gray-800 px-2 py-2 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-gray-400">
                Hourly limit
              </label>

              <input
                type="number"
                min="1"
                value={hourlyLimit}
                onChange={(e) =>
                  setHourlyLimit(Number(e.target.value))
                }
                className="w-full rounded bg-gray-800 px-2 py-2 text-sm outline-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700"
          >
            Cancel
          </button>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
