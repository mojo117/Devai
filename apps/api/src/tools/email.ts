/**
 * Email tool — sends emails via Resend REST API.
 * No SDK dependency, just fetch().
 */

import { config } from '../config.js';

interface EmailResult {
  success: boolean;
  result?: { id: string; message: string };
  error?: string;
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
  return {
    success: true,
    result: {
      id: result.id,
      message: `Email sent to ${to}: "${subject}"`,
    },
  };
}
