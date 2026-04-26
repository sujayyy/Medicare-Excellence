import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import whatsappIcon from "@/assets/whatsapp.png";

const WHATSAPP_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER || "").replace(/\D/g, "");
const SUPPORT_DRAFT_STORAGE_KEY = "medicare-excellence.support-draft";
const VOICE_LANGUAGE_STORAGE_KEY = "medicare-excellence.voice-language";

const SUPPORT_TEMPLATE_BY_LANGUAGE: Record<string, string> = {
  "en-IN": "Hello, I need help with symptoms, prescription understanding, or appointment support.",
  "hi-IN": "Hello, I need healthcare help in Hindi for symptoms, prescription understanding, or appointment support.",
  "kn-IN": "Hello, I need healthcare help in Kannada for symptoms, prescription understanding, or appointment support.",
  "ta-IN": "Hello, I need healthcare help in Tamil for symptoms, prescription understanding, or appointment support.",
  "te-IN": "Hello, I need healthcare help in Telugu for symptoms, prescription understanding, or appointment support.",
  "ml-IN": "Hello, I need healthcare help in Malayalam for symptoms, prescription understanding, or appointment support.",
  "bn-IN": "Hello, I need healthcare help in Bengali for symptoms, prescription understanding, or appointment support.",
};

export default function SupportFab() {
  const [whatsAppDraft, setWhatsAppDraft] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState("en-IN");
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setWhatsAppDraft(window.localStorage.getItem(SUPPORT_DRAFT_STORAGE_KEY) || "");
    setVoiceLanguage(window.localStorage.getItem(VOICE_LANGUAGE_STORAGE_KEY) || "en-IN");
  }, []);

  const whatsAppHref = useMemo(() => {
    const text = whatsAppDraft.trim() || SUPPORT_TEMPLATE_BY_LANGUAGE[voiceLanguage] || SUPPORT_TEMPLATE_BY_LANGUAGE["en-IN"];
    if (!WHATSAPP_NUMBER || WHATSAPP_NUMBER === "919999999999") {
      return "";
    }
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  }, [voiceLanguage, whatsAppDraft]);

  if (!whatsAppHref) {
    return (
      <button
        type="button"
        onClick={() =>
          toast({
            title: "WhatsApp support not configured",
            description: "Add a real VITE_WHATSAPP_NUMBER to connect this button to your Medicare Excellence support line.",
          })
        }
        className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full shadow-[0_18px_40px_rgba(37,211,102,0.35)] transition-transform hover:scale-[1.04]"
        aria-label="WhatsApp support not configured"
        title="WhatsApp support not configured"
      >
        <img src={whatsappIcon} alt="" aria-hidden="true" className="h-14 w-14 rounded-full object-cover" />
      </button>
    );
  }

  return (
    <a
      href={whatsAppHref}
      target="_blank"
      rel="noreferrer"
      className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full shadow-[0_18px_40px_rgba(37,211,102,0.35)] transition-transform hover:scale-[1.04]"
      aria-label="Open WhatsApp assistant"
      title="Open WhatsApp assistant"
    >
      <img src={whatsappIcon} alt="" aria-hidden="true" className="h-14 w-14 rounded-full object-cover" />
    </a>
  );
}
