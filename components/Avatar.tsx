const STYLES: Record<string, { bg: string; mark: string }> = {
  human: { bg: 'bg-[#2a7fe8]', mark: '\u{1F464}' },
  claude: { bg: 'bg-[#d97757]', mark: '✳' },
  gpt: { bg: 'bg-[#0f9d76]', mark: '⍟' },
  gemini: { bg: 'bg-[#3b7de8]', mark: '✦' },
  llama: { bg: 'bg-[#8b6bd4]', mark: '\u{1F999}' },
  mistral: { bg: 'bg-[#e2a63a]', mark: '◩' },
};

export function Avatar({ avatar, size = 42 }: { avatar: string; size?: number }) {
  const s = STYLES[avatar] ?? STYLES.human;
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full ${s.bg} text-white shadow-inner`}
      style={{ width: size, height: size, fontSize: size * 0.48 }}
    >
      {s.mark}
    </div>
  );
}
