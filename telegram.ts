type TelegramEnv = {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
};

export async function sendTelegram(env: TelegramEnv, text: string): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: text.slice(0, 4000),
        disable_web_page_preview: true
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  }

  const json = await response.json() as { ok?: boolean };
  if (!json.ok) throw new Error("Telegram sendMessage returned ok=false.");
}
