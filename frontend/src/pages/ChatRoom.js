import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import { getLawyerById } from '../api/lawyers';
import { createChatRoom } from '../api/realTimeChat';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import DocumentUpload from '../components/DocumentUpload';
import DocumentAnalysis from '../components/DocumentAnalysis';

const ChatRoom = () => {
  const { lawyerId } = useParams();
  const { theme } = useTheme();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [lawyer, setLawyer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatRoomId, setChatRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  // Debug logging
  console.log('🔍 ChatRoom - lawyerId from URL:', lawyerId);
  console.log('🔍 ChatRoom - user:', user);
  console.log('🔍 ChatRoom - isAuthenticated:', isAuthenticated);

  // Validate lawyer ID
  useEffect(() => {
    if (!lawyerId || lawyerId === 'undefined') {
      console.error('❌ Invalid lawyer ID:', lawyerId);
      setError('Invalid lawyer ID provided');
      setLoading(false);
      return;
    }

    if (!isAuthenticated) {
      console.log('❌ User not authenticated, redirecting to login');
      navigate('/auth', { 
        state: { 
          from: { pathname: `/chat/${lawyerId}` },
          message: 'Please log in to start a consultation' 
        } 
      });
      return;
    }

    if (!user) {
      console.log('❌ No user data available');
      setError('User data not available');
      setLoading(false);
      return;
    }

    console.log('✅ ChatRoom validation passed, initializing...');
  }, [lawyerId, isAuthenticated, user, navigate]);

  useEffect(() => {
    if (!lawyerId || lawyerId === 'undefined' || !isAuthenticated || !user) {
      return;
    }

    let mounted = true;
    let socketInstance = null;

    const initializeChat = async () => {
      try {
        console.log('🔄 Initializing chat with lawyer:', lawyerId);
        console.log('👤 Client user:', user);
        
        const lawyerResult = await getLawyerById(lawyerId);
        if (lawyerResult.success && mounted) {
          setLawyer(lawyerResult.lawyer);
          console.log('✅ Lawyer details loaded:', lawyerResult.lawyer.personalInfo.fullName);
        } else {
          console.error('❌ Failed to load lawyer:', lawyerResult);
          setError('Failed to load lawyer information');
          setLoading(false);
          return;
        }

        const clientId = user.id;
        const clientName = user.name;

        const chatResult = await createChatRoom({ lawyerId, clientId });
        if (chatResult.success && mounted) {
          const roomId = chatResult.chatRoom.chatRoomId;
          setChatRoomId(roomId);
          console.log('✅ Chat room created/found:', roomId);

          // Create socket connection
          socketInstance = io('http://localhost:5000', {
            forceNew: true,
            transports: ['websocket', 'polling']
          });
          
          setSocket(socketInstance);

          socketInstance.on('connect', () => {
            console.log('✅ Client socket connected:', socketInstance.id);
            if (mounted) {
              setIsConnected(true);
              socketInstance.emit('user_join', { 
                userId: clientId, 
                userType: 'client',
                userName: clientName
              });
              socketInstance.emit('join_chat', { lawyerId, clientId, chatRoomId: roomId });
            }
          });

          socketInstance.on('connect_error', (error) => {
            console.error('❌ Socket connection error:', error);
            if (mounted) setIsConnected(false);
          });

          socketInstance.on('disconnect', (reason) => {
            console.log('🔌 Socket disconnected:', reason);
            if (mounted) setIsConnected(false);
          });

          socketInstance.off('receive_message');
          socketInstance.on('receive_message', (messageData) => {
            console.log('📥 Received message:', messageData);
            if (mounted) {
              setMessages(prev => {
                const exists = prev.some(msg => msg.messageId === messageData.messageId);
                if (exists) {
                  console.log('⚠️ Duplicate message prevented:', messageData.messageId);
                  return prev;
                }
                return [...prev, messageData];
              });
            }
          });

          socketInstance.off('chat_history');
          socketInstance.on('chat_history', (data) => {
            console.log('📜 Loading chat history:', data.messages);
            if (mounted) setMessages(data.messages || []);
          });

          socketInstance.off('user_typing');
          socketInstance.on('user_typing', (data) => {
            console.log('⌨️ Typing indicator:', data);
            if (mounted) setIsTyping(data.isTyping);
          });

          socketInstance.off('user_joined_chat');
          socketInstance.on('user_joined_chat', (data) => {
            console.log('👋 User joined chat:', data);
          });
        } else {
          console.error('❌ Failed to create chat room:', chatResult);
          setError('Failed to create chat room');
        }
      } catch (error) {
        console.error('❌ Error initializing chat:', error);
        setError('Failed to initialize chat');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initializeChat();

    return () => {
      mounted = false;
      if (socketInstance) {
        socketInstance.off('connect');
        socketInstance.off('connect_error');
        socketInstance.off('disconnect');
        socketInstance.off('receive_message');
        socketInstance.off('chat_history');
        socketInstance.off('user_typing');
        socketInstance.off('user_joined_chat');
        socketInstance.disconnect();
        console.log('🧹 Socket cleaned up and disconnected');
      }
    };
  }, [lawyerId, user, isAuthenticated]);

  const handleDocumentUpload = (document) => {
    console.log('📄 Document uploaded:', document);
    setDocuments(prev => [document, ...prev]);
    setShowDocumentUpload(false);
    
    if (socket && chatRoomId && user) {
      const notificationMessage = {
        chatRoomId,
        message: `📄 Document uploaded: ${document.originalName}`,
        senderId: user.id,
        senderType: 'client',
        senderName: user.name,
        messageId: `${Date.now()}_${user.id}_doc_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        isDocumentNotification: true,
        documentId: document.id
      };
      
      setMessages(prev => [...prev, notificationMessage]);
      socket.emit('send_message', notificationMessage);
    }
  };

  const sendMessage = useCallback(() => {
    if (currentMessage.trim() && socket && chatRoomId && isConnected && user) {
      const messageData = {
        chatRoomId,
        message: currentMessage,
        senderId: user.id,
        senderType: 'client',
        senderName: user.name,
        messageId: `${Date.now()}_${user.id}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date()
      };
      
      console.log('📤 Sending message:', messageData);
      
      setCurrentMessage('');
      
      setMessages(prev => {
        const exists = prev.some(msg => msg.messageId === messageData.messageId);
        if (exists) return prev;
        return [...prev, messageData];
      });
      
      socket.emit('send_message', messageData);
    }
  }, [currentMessage, socket, chatRoomId, isConnected, user]);

  const handleTyping = useCallback((typing) => {
    if (socket && chatRoomId && user) {
      socket.emit('typing', {
        chatRoomId,
        userId: user.id,
        isTyping: typing
      });
    }
  }, [socket, chatRoomId, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) {
    return (
      <div style={{ 
        background: theme.primary,
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif'
      }}>
        <div style={{ 
          textAlign: 'center',
          background: theme.card,
          padding: '3rem',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          border: `1px solid ${theme.border}`
        }}>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            border: `4px solid ${theme.border}`,
            borderTop: `4px solid ${theme.accent}`,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 1rem auto'
          }}></div>
          <p style={{ color: theme.text, fontSize: '1.1rem', fontWeight: '500', margin: 0 }}>
            Connecting to lawyer...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        background: theme.primary,
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif'
      }}>
        <div style={{ 
          textAlign: 'center',
          background: theme.card,
          padding: '3rem',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          border: `1px solid ${theme.danger}`
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❌</div>
          <h2 style={{ color: theme.danger, margin: '0 0 1rem 0' }}>Error</h2>
          <p style={{ color: theme.text, margin: '0 0 2rem 0' }}>{error}</p>
          <Link 
            to="/lawyers" 
            style={{
              background: theme.accent,
              color: 'white',
              padding: '12px 24px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: '600'
            }}
          >
            Back to Lawyers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      background: theme.primary,
      minHeight: '100vh',
      fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      color: theme.text
    }}>
      {/* Top Navigation Bar */}
      <div style={{
        background: theme.header,
        borderBottom: `1px solid ${theme.border}`,
        padding: '0 24px',
        height: '60px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        position: 'sticky',
        top: 64,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link to="/lawyers" style={{ 
            color: theme.text, 
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '6px',
            border: `1px solid ${theme.border}`,
            transition: 'all 0.2s ease'
          }}>
            ← Back to Lawyers
          </Link>
          
          <div style={{
            width: '36px',
            height: '36px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: '600',
            fontSize: '16px'
          }}>
            L
          </div>
          <div>
            <h1 style={{ 
              margin: 0, 
              fontSize: '20px', 
              fontWeight: '600',
              color: theme.text
            }}>
              LegalPro Chat
            </h1>
            <p style={{ 
              margin: 0, 
              fontSize: '14px', 
              color: theme.textSecondary
            }}>
              Client Portal - {user?.name}
            </p>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            borderRadius: '16px',
            background: isConnected ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
            border: `1px solid ${isConnected ? theme.success : theme.danger}`
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isConnected ? theme.success : theme.danger
            }} />
            <span style={{ 
              fontSize: '12px', 
              fontWeight: '500',
              color: isConnected ? theme.success : theme.danger
            }}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <div style={{ 
        maxWidth: '1000px', 
        margin: '0 auto',
        height: 'calc(100vh - 124px)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Chat Header */}
        {lawyer && (
          <div style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${theme.border}`,
            background: theme.secondary
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: lawyer.personalInfo.profilePhoto 
                  ? `url(http://localhost:5000/uploads/lawyer-documents/${lawyer.personalInfo.profilePhoto})` 
                  : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '24px',
                fontWeight: 'bold',
                border: `3px solid ${theme.border}`
              }}>
                {!lawyer.personalInfo.profilePhoto && lawyer.personalInfo.fullName?.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ 
                  color: theme.text, 
                  margin: 0, 
                  fontSize: '20px', 
                  fontWeight: '600',
                  marginBottom: '4px'
                }}>
                  {lawyer.personalInfo.fullName}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ 
                    color: theme.textSecondary, 
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {lawyer.availability?.isOnline ? (
                      <>🟢 Online</>
                    ) : (
                      <>⚫ Offline</>
                    )}
                  </span>
                  <span style={{ color: theme.textSecondary, fontSize: '14px' }}>•</span>
                  <span style={{ color: theme.textSecondary, fontSize: '14px' }}>
                    {lawyer.credentials?.specializations?.[0]}
                  </span>
                  <span style={{ color: theme.textSecondary, fontSize: '14px' }}>•</span>
                  <span style={{ 
                    color: theme.accent, 
                    fontSize: '14px',
                    fontWeight: '600'
                  }}>
                    ₹{lawyer.availability?.consultationFees?.toLocaleString()}/consultation
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Document Upload Section */}
        <div style={{
          padding: '1rem 24px',
          borderBottom: `1px solid ${theme.border}`,
          background: theme.secondary
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            maxWidth: '800px',
            margin: '0 auto'
          }}>
            <h4 style={{
              color: theme.text,
              margin: 0,
              fontSize: '1rem',
              fontWeight: '600'
            }}>
              📄 Document Analysis
            </h4>
            
            <button
              onClick={() => setShowDocumentUpload(!showDocumentUpload)}
              style={{
                background: theme.accent,
                color: 'white',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = theme.accentHover;
              }}
              onMouseLeave={(e) => {
                e.target.style.background = theme.accent;
              }}
            >
              {showDocumentUpload ? '✕ Cancel' : '📤 Upload PDF'}
            </button>
          </div>
          
          {showDocumentUpload && (
            <div style={{
              maxWidth: '800px',
              margin: '1rem auto 0 auto'
            }}>
              <DocumentUpload
                onUploadSuccess={handleDocumentUpload}
                uploadedBy={user?.id}
                userType="client"
                lawyerId={lawyerId}
                chatRoomId={chatRoomId}
              />
            </div>
          )}
          
          {documents.length > 0 && (
            <div style={{
              maxWidth: '800px',
              margin: '1rem auto 0 auto'
            }}>
              {documents.map((doc, index) => (
                <DocumentAnalysis key={doc.id || index} document={doc} />
              ))}
            </div>
          )}
        </div>

        {/* Messages Area */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px',
          background: theme.primary
        }}>
          {messages.length === 0 ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              color: theme.textSecondary
            }}>
              <div>
                <div style={{ fontSize: '64px', marginBottom: '16px', opacity: 0.3 }}>💬</div>
                <h3 style={{ 
                  margin: '0 0 8px 0', 
                  fontSize: '18px',
                  color: theme.text
                }}>
                  Start Your Legal Consultation
                </h3>
                <p style={{ margin: 0, fontSize: '14px' }}>
                  Send a message to {lawyer?.personalInfo.fullName} to begin your consultation
                </p>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
              {messages.map((message, index) => (
                <div key={message.messageId || index} style={{
                  marginBottom: '16px',
                  display: 'flex',
                  justifyContent: message.senderType === 'client' ? 'flex-end' : 'flex-start',
                  animation: 'slideIn 0.3s ease-out'
                }}>
                  <div style={{
                    maxWidth: '70%',
                    display: 'flex',
                    flexDirection: message.senderType === 'client' ? 'row-reverse' : 'row',
                    alignItems: 'flex-end',
                    gap: '8px'
                  }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: message.senderType === 'client' ? theme.accent : theme.tertiary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: message.senderType === 'client' ? 'white' : theme.text,
                      fontSize: '14px',
                      fontWeight: '600',
                      flexShrink: 0
                    }}>
                      {message.senderType === 'client' ? 'C' : 'L'}
                    </div>

                    <div style={{
                      background: message.isDocumentNotification 
                        ? `${theme.accent}20` 
                        : message.senderType === 'client' 
                          ? theme.messageOwn 
                          : theme.messageOther,
                      color: message.isDocumentNotification 
                        ? theme.accent 
                        : message.senderType === 'client' 
                          ? 'white' 
                          : theme.text,
                      padding: '12px 16px',
                      borderRadius: '18px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                      position: 'relative',
                      border: message.isDocumentNotification ? `1px solid ${theme.accent}50` : 'none'
                    }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        marginBottom: '4px',
                        opacity: 0.8
                      }}>
                        {message.senderName || (message.senderType === 'client' ? user?.name : lawyer?.personalInfo.fullName)}
                      </div>
                      
                      <div style={{
                        fontSize: '14px',
                        lineHeight: '1.4',
                        wordBreak: 'break-word'
                      }}>
                        {message.message}
                      </div>
                      
                      <div style={{
                        fontSize: '11px',
                        opacity: 0.6,
                        marginTop: '4px',
                        textAlign: 'right'
                      }}>
                        {new Date(message.timestamp).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '8px',
                  marginBottom: '16px',
                  animation: 'pulse 1.5s infinite'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: theme.tertiary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px'
                  }}>
                    L
                  </div>
                  <div style={{
                    background: theme.messageOther,
                    color: theme.text,
                    padding: '12px 16px',
                    borderRadius: '18px',
                    fontSize: '14px',
                    fontStyle: 'italic'
                  }}>
                    {lawyer?.personalInfo.fullName} is typing...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Message Input */}
        <div style={{
          padding: '20px 24px',
          borderTop: `1px solid ${theme.border}`,
          background: theme.secondary
        }}>
          <div style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-end',
            maxWidth: '800px',
            margin: '0 auto'
          }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <textarea
                value={currentMessage}
                onChange={(e) => setCurrentMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Type your legal question..."
                disabled={!isConnected}
                rows={1}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  maxHeight: '120px',
                  padding: '12px 16px',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '22px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  background: theme.primary,
                  color: theme.text,
                  outline: 'none',
                  resize: 'none',
                  transition: 'border-color 0.2s ease'
                }}
                onFocus={(e) => {
                  if (isConnected) {
                    e.target.style.borderColor = theme.accent;
                    handleTyping(true);
                  }
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = theme.border;
                  handleTyping(false);
                }}
              />
            </div>
            
            <button
              onClick={sendMessage}
              disabled={!currentMessage.trim() || !isConnected}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                border: 'none',
                background: (currentMessage.trim() && isConnected) ? theme.accent : theme.tertiary,
                color: (currentMessage.trim() && isConnected) ? 'white' : theme.textSecondary,
                cursor: (currentMessage.trim() && isConnected) ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                transition: 'all 0.2s ease',
                transform: (currentMessage.trim() && isConnected) ? 'scale(1)' : 'scale(0.95)'
              }}
              onMouseEnter={(e) => {
                if (currentMessage.trim() && isConnected) {
                  e.target.style.background = theme.accentHover;
                  e.target.style.transform = 'scale(1.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (currentMessage.trim() && isConnected) {
                  e.target.style.background = theme.accent;
                  e.target.style.transform = 'scale(1)';
                }
              }}
            >
              ➤
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        ::-webkit-scrollbar {
          width: 6px;
        }

        ::-webkit-scrollbar-track {
          background: ${theme.secondary};
        }

        ::-webkit-scrollbar-thumb {
          background: ${theme.border};
          border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: ${theme.textSecondary};
        }

        textarea::-webkit-scrollbar {
          width: 4px;
        }
      `}</style>
    </div>
  );
};

export default ChatRoom;
