import DashboardLayout from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { ApiError, sendChatMessage } from "@/lib/api";
import { Brain, Send, User, Bot, Sparkles } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

type Message = { role: "user" | "assistant"; content: string };

const suggestions = [
  "I have a persistent headache and fever",
  "What are signs of heart disease?",
  "Recommend a specialist for back pain",
  "What should I do for high blood pressure?",
];
export default function AIAssistant() {
  const { token } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];

    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);

    try {
      const data = await sendChatMessage(token || "", text);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response },
      ]);
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            error instanceof ApiError
              ? error.message
              : "I’m having trouble reaching the backend right now. Please try again in a moment.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
        <div className="mb-4">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Brain className="w-5 h-5 sm:w-6 sm:h-6 text-primary" /> AI Health Assistant
          </h1>
          <p className="text-muted-foreground font-body text-xs sm:text-sm">
            Describe your symptoms for AI-powered guidance.
          </p>
        </div>

        <Card className="flex-1 flex flex-col shadow-card overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-8 sm:py-12">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-hero flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 text-primary-foreground" />
                </div>
                <h3 className="font-display font-semibold text-foreground mb-2">
                  How can I help you today?
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md px-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-xs sm:text-sm p-3 rounded-lg bg-muted hover:bg-accent"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 sm:gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "assistant" && (
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-hero flex items-center justify-center">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                )}

                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-white"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  ) : (
                    m.content
                  )}
                </div>

                {m.role === "user" && (
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted flex items-center justify-center">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-hero flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-muted rounded-xl px-4 py-3 text-sm">
                  <span className="animate-pulse">Analyzing...</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-2"
            >
              <Input
                placeholder="Describe your symptoms..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <Button type="submit" size="icon" disabled={!input.trim() || isLoading}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
