import { config } from '../config.js';

const TELEGRAM_MESSAGE_MAX = 4000;

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: {
      id: number | string;
      type?: string;
    };
    from?: {
      id: number | string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    date?: number;
  };
}

function truncateTelegramMessage(text: string): string {
  if (text.length <= TELEGRAM_MESSAGE_MAX) return text;
  return `${text.slice(0, TELEGRAM_MESSAGE_MAX - 30)}\n\n...[truncated for Telegram]`;
}

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const token = config.telegramBotToken;
  if (!token) {
    console.error('[Telegram] Bot token not configured');
    return;
  }

  const payload = {
    chat_id: String(chatId),
    text: truncateTelegramMessage(text || ''),
    parse_mode: 'Markdown',
  };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.ok) return;

  const retry = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      text: truncateTelegramMessage(text || ''),
    }),
  });

  if (!retry.ok) {
    const responseText = await retry.text();
    console.error('[Telegram] Failed to send message:', responseText);
  }
}

export function isAllowedChat(chatId: string | number): boolean {
  const allowed = config.telegramAllowedChatId;
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}
