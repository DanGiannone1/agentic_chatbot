import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import ReactMarkdown from 'react-markdown';

interface Step {
  type: 'analyze' | 'search' | 'validate' | 'result' | 'stream' | 'process' | 'error';
  text: string;
  status: 'loading' | 'complete' | 'error';
}

interface Message {
  isUser: boolean;
  content: Step;
}

// StepBox component renders individual messages
const StepBox: React.FC<Message> = ({ isUser, content }) => {
  return (
    <div className={`step-box ${content.type} ${isUser ? 'user-message' : 'ai-message'}`}>
      <div className="step-content">
        <ReactMarkdown>{content.text}</ReactMarkdown>
      </div>
      {/* Only show status indicators for non-user, non-stream messages */}
      {!isUser && content.type !== 'stream' && (
        <div className={`step-status ${content.status}`}>
          {content.status === 'loading' && <div className="loading-spinner"></div>}
          {content.status === 'complete' && <div className="checkmark">✓</div>}
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  // State hooks
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Ref for auto-scrolling
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  // Function to scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Effect to scroll to bottom when messages change
  useEffect(scrollToBottom, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
  
    // Set processing state and add user message
    setIsProcessing(true);
    setMessages(prev => [...prev, { isUser: true, content: { type: 'result', text: input, status: 'complete' } }]);
    setInput('');
  
    // Create EventSource for server-sent events
    const eventSource = new EventSource(`http://localhost:5000/run?message=${encodeURIComponent(input)}`);
  
    eventSource.onmessage = (event) => {
      const step: Step = JSON.parse(event.data);
      setMessages(prev => {
        const newMessages = [...prev];
        
        // Mark the previous non-stream message as complete
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (!newMessages[i].isUser && newMessages[i].content.type !== 'stream') {
            newMessages[i].content.status = 'complete';
            break;  // Only update the most recent non-stream message
          }
        }
        
        // Add or update the new message
        if (step.type === 'stream') {
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && !lastMessage.isUser && lastMessage.content.type === 'stream') {
            // Update existing stream message
            lastMessage.content.text = step.text;
          } else {
            // Add new stream message
            newMessages.push({ isUser: false, content: { ...step, status: 'complete' } });
          }
        } else {
          // Add new non-stream message with loading status
          newMessages.push({ isUser: false, content: { ...step, status: 'loading' } });
        }
        
        console.log('Updated messages:', newMessages);  // Add this line for debugging
        return newMessages;
      });
  
      // Set processing to false for non-stream messages
      if (step.type !== 'stream') {
        setIsProcessing(false);
      }
    };
  
    eventSource.addEventListener('update', (event) => {
      const step: Step = JSON.parse(event.data);
      setMessages(prev => {
        const newMessages = [...prev];
        
        // Mark the previous non-stream message as complete
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (!newMessages[i].isUser && newMessages[i].content.type !== 'stream') {
            newMessages[i].content.status = 'complete';
            break;  // Only update the most recent non-stream message
          }
        }
  
        if (step.type === 'stream') {
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && !lastMessage.isUser && lastMessage.content.type === 'stream') {
            // Update existing stream message
            lastMessage.content.text = step.text;
          } else {
            // Add new stream message
            newMessages.push({ isUser: false, content: { ...step, status: 'complete' } });
          }
        }
        
        console.log('Updated messages after update event:', newMessages);  // Add this line for debugging
        return newMessages;
      });
    });

    
  
    eventSource.onerror = (error) => {
      console.error('EventSource failed:', error);
      eventSource.close();
      setIsProcessing(false);
      setMessages(prev => prev.map(msg => 
        msg.isUser || msg.content.status === 'complete' 
          ? msg 
          : { ...msg, content: { ...msg.content, status: 'error' } }
      ));
    };

    
  };
  

  // Render component
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