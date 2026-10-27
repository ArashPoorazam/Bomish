import { Leaf, UserRound } from "lucide-react";

export function ChatAvatar({
  support = false,
  seed = "",
}: {
  support?: boolean;
  seed?: string;
}) {
  const tone =
    Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  return (
    <span
      aria-hidden="true"
      className={`chat-avatar ${support ? "is-support" : `customer-tone-${tone}`}`}
    >
      {support ? <Leaf size={19} /> : <UserRound size={18} />}
    </span>
  );
}
