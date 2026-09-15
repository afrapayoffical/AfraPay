/* eslint-disable no-console */
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import { Icon } from "../common/Icons";
import { Button } from "../index";
import { chatAPI } from "../../services/api";
import toast from "react-hot-toast";

const LiveChat = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [chatSession, setChatSession] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [adminOnline, setAdminOnline] = useState(false);
  const messagesEndRef = useRef(null);
  const ws = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize chat session
  useEffect(() => {
    if (isOpen && !chatSession) {
      initializeChat();
    }
  }, [isOpen]);

  // WebSocket connection
  useEffect(() => {
    if (isOpen && chatSession) {
      connectWebSocket();
    }
    return () => {
      if (ws.current) {
        ws.current.disconnect();
      }
    };
  }, [isOpen, chatSession]);

  const initializeChat = async () => {
    setIsLoading(true);
    try {
      const response = await chatAPI.createSession();
      if (response.success) {
        setChatSession(response.data);
        // Load chat history if any
        if (response.data.messageCount > 0) {
          await loadChatHistory(response.data.sessionId);
        }
      }
    } catch (error) {
      console.error("Failed to initialize chat:", error);
      toast.error("Failed to start chat. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadChatHistory = async (sessionId) => {
    try {
      const response = await chatAPI.getMessages(sessionId);
      if (response.success) {
        setMessages(response.data.messages || []);
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
    }
  };

  const connectWebSocket = () => {
    const serverUrl =
      process.env.REACT_APP_API_BASE_URL?.replace("/api/v1", "") ||
      "http://localhost:5000";

    ws.current = io(serverUrl, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    ws.current.on("connect", () => {
      console.log("Socket.IO connected");
      setIsConnected(true);

      // Join chat room
      ws.current.emit("join_chat", {
        sessionId: chatSession.sessionId,
        userType: "customer",
      });
    });

    ws.current.on("new_message", (data) => {
      setMessages((prev) => [...prev, data.message]);
    });

    ws.current.on("admin_typing", (data) => {
      setIsTyping(data.isTyping);
    });

    ws.current.on("admin_status", (data) => {
      setAdminOnline(data.online);
    });

    ws.current.on("chat_joined", () => {
      console.log("Joined chat session");
    });

    ws.current.on("disconnect", (reason) => {
      console.log("Socket.IO disconnected:", reason);
      setIsConnected(false);
      setAdminOnline(false);
    });

    ws.current.on("connect_error", (error) => {
      console.error("Socket.IO connection error:", error);
      setIsConnected(false);
    });
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !chatSession || !isConnected) return;

    const messageText = newMessage.trim();
    setNewMessage("");

    try {
      // Send via Socket.IO for real-time delivery
      ws.current.emit("send_message", {
        sessionId: chatSession.sessionId,
        message: messageText,
        userType: "customer",
      });

      // Also save to database via API
      await chatAPI.sendMessage(chatSession.sessionId, {
        message: messageText,
        sender: "customer",
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      toast.error("Failed to send message. Please try again.");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const notifyTyping = () => {
    if (ws.current && ws.current.connected) {
      ws.current.emit("typing", {
        sessionId: chatSession?.sessionId,
        userType: "customer",
        isTyping: true,
      });

      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Stop typing after 3 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        if (ws.current && ws.current.connected) {
          ws.current.emit("typing", {
            sessionId: chatSession?.sessionId,
            userType: "customer",
            isTyping: false,
          });
        }
      }, 3000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-neutral-200 w-96 h-[500px] flex flex-col pointer-events-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-primary-600 text-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center">
              <img
                src="/logo.png"
                alt="AfraPay Logo"
                className="w-10 h-10 object-contain"
              />
            </div>
            <div>
              <h3 className="font-semibold text-sm">AfraPay Support</h3>
              <div className="flex items-center gap-1">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isConnected && adminOnline
                      ? "bg-green-400"
                      : "bg-yellow-400"
                  }`}
                />
                <span className="text-xs text-primary-100">
                  {isConnected
                    ? adminOnline
                      ? "Agent available"
                      : "We'll be right with you"
                    : "Connecting..."}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors"
          >
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <img
                  src="/logo.png"
                  alt="AfraPay Logo"
                  className="w-10 h-10 object-contain"
                />
              </div>
              <p className="text-neutral-600 text-sm mb-2">
                Welcome to AfraPay Support!
              </p>
              <p className="text-neutral-400 text-xs">
                How can we help you today?
              </p>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.sender === "customer" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-xs px-3 py-2 rounded-2xl text-sm ${
                      message.sender === "customer"
                        ? "bg-primary-600 text-white rounded-br-sm"
                        : "bg-white text-neutral-800 rounded-bl-sm border border-neutral-200"
                    }`}
                  >
                    {message.message}
                    <div
                      className={`text-xs mt-1 ${
                        message.sender === "customer"
                          ? "text-primary-200"
                          : "text-neutral-400"
                      }`}
                    >
                      {new Date(
                        message.timestamp || message.$createdAt,
                      ).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white text-neutral-800 rounded-2xl rounded-bl-sm border border-neutral-200 px-3 py-2 max-w-xs">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"></div>
                      <div
                        className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      ></div>
                      <div
                        className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="p-4 bg-white border-t border-neutral-100 rounded-b-2xl">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <textarea
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  notifyTyping();
                }}
                onKeyPress={handleKeyPress}
                placeholder={
                  isConnected ? "Type your message..." : "Connecting..."
                }
                disabled={!isConnected || !chatSession}
                rows={1}
                className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ minHeight: "40px", maxHeight: "120px" }}
                onInput={(e) => {
                  e.target.style.height = "auto";
                  e.target.style.height =
                    Math.min(e.target.scrollHeight, 120) + "px";
                }}
              />
            </div>
            <Button
              size="sm"
              onClick={sendMessage}
              disabled={!newMessage.trim() || !isConnected || !chatSession}
              className="bg-primary-600 hover:bg-primary-700 text-white px-3 py-2 h-10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m22 2-7 20-4-9-9-4 20-7z" />
                <path d="M22 2 11 13" />
              </svg>
            </Button>
          </div>
          <p className="text-xs text-neutral-400 mt-2 text-center">
            🔒 End-to-end encrypted • Powered by AfraPay
          </p>
        </div>
      </div>
    </div>
  );
};

export default LiveChat;
