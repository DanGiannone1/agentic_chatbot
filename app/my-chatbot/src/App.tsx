import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import ReactMarkdown from 'react-markdown';

interface Step {
  type: 'analyze' | 'search' | 'validate' | 'result' | 'stream' | 'process' | 'error';
  text: string;
}

interface Message {
  isUser: boolean;
  content: Step;
}

const StepBox: React.FC<Message> = ({ isUser, content }) => {
  console.log("Received content:", content.text);
  return (
    <div className={`step-box ${content.type} ${isUser ? 'user-message' : 'ai-message'}`}>
      <ReactMarkdown>{content.text}</ReactMarkdown>
    </div>
  );
};

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);
    setMessages(prev => [...prev, { isUser: true, content: { type: 'result', text: input } }]);
    setInput('');

    const eventSource = new EventSource(`http://localhost:5000/run?message=${encodeURIComponent(input)}`);

    eventSource.onmessage = (event) => {
      const step: Step = JSON.parse(event.data);
      if (step.type === 'stream') {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && !lastMessage.isUser && lastMessage.content.type === 'stream') {
            lastMessage.content.text = step.text;
            return newMessages;
          } else {
            return [...prev, { isUser: false, content: step }];
          }
        });
      } else {
        setMessages(prev => [...prev, { isUser: false, content: step }]);
      }

      if (step.type === 'result') {
        eventSource.close();
        setIsProcessing(false);
      }
    };

    eventSource.addEventListener('update', (event) => {
      const step: Step = JSON.parse(event.data);
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage && !lastMessage.isUser && lastMessage.content.type === 'stream') {
          lastMessage.content.text = step.text;
          return newMessages;
        } else {
          return [...prev, { isUser: false, content: step }];
        }
      });
    });

    eventSource.onerror = (error) => {
      console.error('EventSource failed:', error);
      eventSource.close();
      setIsProcessing(false);
    };
  };

  return (
    <div className="App">
      <h1 className="app-title">AI Chatbot</h1>
      <header className="App-header">
        <div className="chat-container">
          <div className="messages-container">
            {messages.map((message, index) => (
              <StepBox
                key={index}
                isUser={message.isUser}
                content={message.content}
              />
            ))}
          </div>
          <div ref={messagesEndRef} />
        </div>
      </header>
      <form onSubmit={handleSubmit} className="input-form">
        <div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isProcessing}
          />
          <button type="submit" disabled={isProcessing}>Send</button>
        </div>
      </form>
    </div>
  );
};

export default App;