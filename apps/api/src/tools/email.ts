/**
 * Email tool — sends emails via Resend REST API.
 * No SDK dependency, just fetch().
 */

import { config } from '../config.js';

interface EmailResult {
  success: boolean;
  result?: {
    id: string;
    message: string;
    providerStatus?: string;
    providerCreatedAt?: string;
  };
  error?: string;
}

interface ResendEmailDetails {
  id: string;
  created_at?: string;
  last_event?: string;
}

async function fetchResendEmailDetails(apiKey: string, emailId: string): Promise<ResendEmailDetails | null> {
  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) return null;
    return (await response.json()) as ResendEmailDetails;
  } catch {
    return null;
  }
}

function describeProviderStatus(lastEvent?: string): string {
  const normalized = (lastEvent || '').trim().toLowerCase();
  switch (normalized) {
    case 'delivered':
      return 'Provider-Status: delivered (an den empfangenden Mailserver uebergeben).';
    case 'bounced':
      return 'Provider-Status: bounced (nicht zustellbar).';
    case 'complained':
      return 'Provider-Status: complained (Empfaenger hat Beschwerde gemeldet).';
    case 'delivery_delayed':
      return 'Provider-Status: delivery_delayed (Zustellung verzoegert).';
    case 'sent':
      return 'Provider-Status: sent (angenommen und in Zustellung).';
    default:
      return normalized
        ? `Provider-Status: ${normalized}.`
        : 'Provider-Status: accepted (noch ohne finales Zustell-Event).';
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  replyTo?: string,
): Promise<EmailResult> {
  const apiKey = config.resendApiKey;
  const fromAddress = config.resendFromAddress;

  if (!apiKey) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!fromAddress) {
    return { success: false, error: 'RESEND_FROM_ADDRESS not configured' };
  }

  const payload: Record<string, unknown> = {
    from: fromAddress,
    to: [to],
    subject,
    text: body,
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    return {
      success: false,
      error: `Resend API error (${response.status}): ${errorBody}`,
    };
  }

  const result = await response.json() as { id: string };
  if (!result?.id) {
    return {
      success: false,
      error: 'Resend API antwortete ohne E-Mail-ID.',
    };
  }

  const details = await fetchResendEmailDetails(apiKey, result.id);
  const statusText = describeProviderStatus(details?.last_event);

  return {
    success: true,
    result: {
      id: result.id,
      providerStatus: details?.last_event,
      providerCreatedAt: details?.created_at,
      message: `Email von Resend zur Zustellung angenommen an ${to}: "${subject}". ${statusText} Inbox-Platzierung (Posteingang vs. Spam) kann technisch nicht garantiert werden.`,
    },
  };
}
