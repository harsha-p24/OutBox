import { Client } from "@elastic/elasticsearch";

export const elasticsearch = new Client({
  node: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
});

export const EMAIL_INDEX = "emails";

export async function ensureEmailIndex() {
  const exists = await elasticsearch.indices.exists({
    index: EMAIL_INDEX,
  });

  if (!exists) {
    await elasticsearch.indices.create({
      index: EMAIL_INDEX,
      mappings: {
        properties: {
          id: { type: "keyword" },
          campaignId: { type: "keyword" },
          senderId: { type: "keyword" },
          recipient: { type: "text" },
          subject: { type: "text" },
          body: { type: "text" },
          status: { type: "keyword" },
          scheduledAt: { type: "date" },
          sentAt: { type: "date" },
          messageId: { type: "keyword" },
          errorMessage: { type: "text" },
          createdAt: { type: "date" },
        },
      },
    });

    console.log(`Elasticsearch index "${EMAIL_INDEX}" created`);
  }
}

export async function indexEmail(email: {
  id: string;
  campaignId: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date | null;
  sentAt: Date | null;
  messageId: string | null;
  errorMessage: string | null;
  createdAt: Date;
}) {
  await elasticsearch.index({
    index: EMAIL_INDEX,
    id: email.id,
    document: {
      id: email.id,
      campaignId: email.campaignId,
      senderId: email.senderId,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      status: email.status,
      scheduledAt: email.scheduledAt,
      sentAt: email.sentAt,
      messageId: email.messageId,
      errorMessage: email.errorMessage,
      createdAt: email.createdAt,
    },
    refresh: "wait_for",
  });
}

export async function updateEmailIndex(
  id: string,
  data: {
    status?: string;
    sentAt?: Date | null;
    messageId?: string | null;
    errorMessage?: string | null;
  }
) {
  await elasticsearch.update({
    index: EMAIL_INDEX,
    id,
    doc: data,
    doc_as_upsert: false,
    refresh: "wait_for",
  });
}
