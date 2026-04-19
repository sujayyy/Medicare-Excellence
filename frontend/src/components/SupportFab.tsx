const WHATSAPP_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER || "919999999999").replace(/\D/g, "");
const WHATSAPP_TEXT = encodeURIComponent(
  "Hello, I need multilingual assistance with symptoms, prescriptions, or appointment support.",
);

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M19.11 17.41c-.28-.14-1.62-.8-1.87-.89-.25-.09-.43-.14-.62.14-.19.28-.71.89-.87 1.07-.16.19-.33.21-.61.07-.28-.14-1.17-.43-2.23-1.38-.83-.74-1.39-1.65-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.33.43-.49.14-.17.19-.28.28-.47.09-.19.05-.35-.02-.49-.07-.14-.62-1.49-.85-2.03-.22-.54-.45-.47-.62-.48-.16-.01-.35-.01-.54-.01-.19 0-.49.07-.75.35-.26.28-.98.96-.98 2.35 0 1.39 1 2.72 1.14 2.91.14.19 1.97 3.01 4.78 4.22.67.29 1.2.46 1.61.59.68.22 1.29.19 1.78.12.54-.08 1.62-.66 1.85-1.3.23-.64.23-1.19.16-1.3-.07-.12-.25-.19-.52-.33Z" />
      <path d="M16 3.2c-7.05 0-12.77 5.72-12.77 12.77 0 2.25.59 4.45 1.7 6.39L3.2 28.8l6.61-1.69a12.73 12.73 0 0 0 6.19 1.59h.01c7.04 0 12.79-5.72 12.79-12.77 0-3.42-1.33-6.63-3.75-9.05A12.69 12.69 0 0 0 16 3.2Zm0 23.33h-.01a10.57 10.57 0 0 1-5.39-1.48l-.39-.23-3.92 1 1.05-3.82-.25-.4a10.58 10.58 0 0 1 1.64-13.24A10.48 10.48 0 0 1 16 5.47c2.82 0 5.47 1.1 7.46 3.09 1.99 1.99 3.08 4.63 3.08 7.45 0 5.83-4.73 10.52-10.54 10.52Z" />
    </svg>
  );
}

export default function SupportFab() {
  return (
    <a
      href={`https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_TEXT}`}
      target="_blank"
      rel="noreferrer"
      className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_18px_40px_rgba(37,211,102,0.35)] transition-transform hover:scale-[1.04]"
      aria-label="Open WhatsApp assistant"
      title="Open WhatsApp assistant"
    >
      <WhatsAppIcon />
    </a>
  );
}
