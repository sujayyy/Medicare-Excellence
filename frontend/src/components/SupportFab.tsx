import { MessageCircleMore } from "lucide-react";

const WHATSAPP_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER || "919999999999").replace(/\D/g, "");
const WHATSAPP_TEXT = encodeURIComponent(
  "Hello Medicare Excellence, I need assistance with patient care support.",
);

export default function SupportFab() {
  return (
    <a
      href={`https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_TEXT}`}
      target="_blank"
      rel="noreferrer"
      className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-3 rounded-full bg-[#25D366] px-4 py-3 text-sm font-medium text-white shadow-[0_20px_45px_rgba(37,211,102,0.35)] transition-transform hover:scale-[1.02]"
      aria-label="Chat on WhatsApp"
    >
      <MessageCircleMore className="h-5 w-5" />
      <span className="hidden sm:inline">WhatsApp Care Bot</span>
    </a>
  );
}
