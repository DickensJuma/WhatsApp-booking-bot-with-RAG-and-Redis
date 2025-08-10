const express = require('express');
const router = express.Router();
const { processIncomingMessage } = require('../services/aiService');
const { sendWhatsAppMessage } = require('../services/whatsappService');

// GET webhook verification (required by Meta)
router.get('/', (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  
  // Parse params from the webhook verification request
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  // Check if a token and mode were sent
  if (mode && token) {
    // Check the mode and token sent are correct
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      // Respond with 200 OK and challenge token from the request
      console.log('✅ Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      // Respond with '403 Forbidden' if verify tokens do not match
      console.log('❌ Webhook verification failed');
      res.sendStatus(403);
    }
  } else {
    // Respond with '400 Bad Request' if mode or token are missing
    res.sendStatus(400);
  }
});

// POST webhook to handle incoming messages
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    // Check if this is a page subscription
    if (body.object === 'whatsapp_business_account') {
      // Get the webhook data
      const entries = body.entry || [];
      
      for (const entry of entries) {
        const changes = entry.changes || [];
        
        for (const change of changes) {
          if (change.field === 'messages') {
            const value = change.value;
            
            // Process messages
            if (value.messages && value.messages.length > 0) {
              for (const message of value.messages) {
                await handleIncomingMessage(message, value);
              }
            }
            
            // Process message status updates
            if (value.statuses && value.statuses.length > 0) {
              for (const status of value.statuses) {
                handleMessageStatus(status);
              }
            }
          }
        }
      }
    }

    // Return a '200 OK' response to all webhook events
    res.status(200).send('EVENT_RECEIVED');

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).send('ERROR');
  }
});

// Handle incoming WhatsApp messages
async function handleIncomingMessage(message, value) {
  try {
    console.log('📩 Incoming message:', JSON.stringify(message, null, 2));

    // Only process text messages for now
    if (message.type !== 'text') {
      console.log('⚠️ Ignoring non-text message type:', message.type);
      return;
    }

    const messageText = message.text.body;
    const customerPhone = message.from;
    const messageId = message.id;

    // Get contact info if available
    let customerName = null;
    if (value.contacts && value.contacts.length > 0) {
      const contact = value.contacts.find(c => c.wa_id === customerPhone);
      if (contact && contact.profile) {
        customerName = contact.profile.name;
      }
    }

    console.log(`💬 Message from ${customerName || customerPhone}: "${messageText}"`);

    // Process the message with AI
    const response = await processIncomingMessage({
      messageText,
      customerPhone,
      customerName,
      messageId
    });

    // Send the AI response back to the customer
    if (response && response.trim()) {
      await sendWhatsAppMessage(customerPhone, response);
      console.log('✅ Response sent successfully');
    } else {
      console.log('⚠️ No response generated');
    }

  } catch (error) {
    console.error('❌ Error handling incoming message:', error);
    
    // Send error message to customer
    try {
      await sendWhatsAppMessage(
        message.from, 
        "I apologize, but I'm experiencing some technical difficulties. Please try again in a moment."
      );
    } catch (sendError) {
      console.error('❌ Failed to send error message:', sendError);
    }
  }
}

// Handle message status updates (delivered, read, etc.)
function handleMessageStatus(status) {
  console.log('📊 Message status update:', {
    id: status.id,
    status: status.status,
    timestamp: status.timestamp,
    recipientId: status.recipient_id
  });
}

// Test endpoint for development
router.post('/test', async (req, res) => {
  try {
    const { phone, message } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({
        error: 'Phone number and message are required'
      });
    }

    const response = await processIncomingMessage({
      messageText: message,
      customerPhone: phone,
      customerName: null,
      messageId: `test_${Date.now()}`
    });

    res.json({
      success: true,
      input: message,
      response: response
    });

  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({
      error: 'Failed to process test message',
      details: error.message
    });
  }
});

module.exports = router;