
import React, { useState, useEffect, useRef } from 'react';
import './App.css';  
import ReactMarkdown from 'react-markdown';  

// This is like defining a Python class, but for the shape of our data
// It tells TypeScript what properties a 'Step' should have
interface Step {
  type: 'analyze' | 'search' | 'validate' | 'result' | 'stream' | 'process' | 'error';  // These are the only allowed types
  text: string;  // This will hold the content of the step
}

// Another 'shape' definition, this time for a Message
interface Message {
  isUser: boolean;  // True if the message is from the user, false if from the AI
  content: Step;  // The actual content of the message, using the Step shape we defined above
}

// This is a React component, kind of like a Python function that returns HTML
// It's responsible for displaying a single message box
const StepBox: React.FC<Message> = ({ isUser, content }) => {
  console.log("Received content:", content.text);  // This is just for debugging
  return (
    // This creates a div with classes based on the message type
    <div className={`step-box ${content.type} ${isUser ? 'user-message' : 'ai-message'}`}>
      <ReactMarkdown>{content.text}</ReactMarkdown>  
    </div>
  );
};

// This is our main component, the heart of our app
const App: React.FC = () => {
  // These are like variables, but they can update the screen when they change
  // useState is a React hook that lets us use state in a function component
  const [messages, setMessages] = useState<Message[]>([]);  // This holds all our messages
  const [input, setInput] = useState('');  // This is for the user's current input
  const [isProcessing, setIsProcessing] = useState(false);  // This tracks if we're waiting for a response

  // This is a reference to the bottom of our chat, we'll use it for scrolling
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  // This function scrolls to the bottom of our chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // This is like a Python decorator. It runs after the component updates
  useEffect(scrollToBottom, [messages]);

  // This function handles when the user submits a message
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();  // This stops the form from refreshing the page
    if (!input.trim() || isProcessing) return;  // Don't do anything if the input is empty or we're already processing

    setIsProcessing(true);  // Let the app know we're working on it
    // Add the user's message to our list of messages
    setMessages(prev => [...prev, { isUser: true, content: { type: 'result', text: input } }]);
    setInput('');  // Clear the input box

    // This sets up a connection to our server to get real-time updates
    const eventSource = new EventSource(`http://localhost:5000/run?message=${encodeURIComponent(input)}`);

    // This function runs every time we get a message from the server
    eventSource.onmessage = (event) => {
      const step: Step = JSON.parse(event.data);  // Turn the JSON data into a JavaScript object
      if (step.type === 'stream') {
        // If it's a stream, update the last message instead of adding a new one
        setMessages(prev => {
          const newMessages = [...prev];  // Make a copy of our messages
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && !lastMessage.isUser && lastMessage.content.type === 'stream') {
            lastMessage.content.text = step.text;  // Update the last message
            return newMessages;
          } else {
            return [...prev, { isUser: false, content: step }];  // Or add a new message
          }
        });
      } else {
        // For other types, just add a new message
        setMessages(prev => [...prev, { isUser: false, content: step }]);
      }

      if (step.type === 'result') {
        // If we're done, close the connection and stop processing
        eventSource.close();
        setIsProcessing(false);
      }
    };

    // This handles a special type of update from the server
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

    // If something goes wrong with our server connection, log it and stop processing
    eventSource.onerror = (error) => {
      console.error('EventSource failed:', error);
      eventSource.close();
      setIsProcessing(false);
    };
  };

  // This is what actually gets rendered to the screen
  return (
    <div className="App">
      <h1 className="app-title">AI Chatbot</h1>
      <header className="App-header">
        <div className="chat-container">
          <div className="messages-container">
            {/* This maps over our messages and creates a StepBox for each one */}
            {messages.map((message, index) => (
              <StepBox
                key={index}
                isUser={message.isUser}
                content={message.content}
              />
            ))}
          </div>
          <div ref={messagesEndRef} />  {/* This is our scroll target */}
        </div>
      </header>
      {/* This is our input form */}
      <form onSubmit={handleSubmit} className="input-form">
        <div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}  // Update input as user types
            placeholder="Type your message..."
            disabled={isProcessing}  // Disable input while processing
          />
          <button type="submit" disabled={isProcessing}>Send</button>
        </div>
      </form>
    </div>
  );
};

// This line makes our App available to other parts of our project
export default App;