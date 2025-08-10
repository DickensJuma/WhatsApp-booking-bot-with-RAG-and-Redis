# Spark WhatsApp AI - Appointment Scheduling Agent

A complete WhatsApp AI-powered appointment scheduling system that allows customers to book, reschedule, and cancel appointments through WhatsApp conversations. Built with Node.js, MongoDB (Mongoose), and OpenAI GPT-4o-mini. Now includes optional LangChain-powered RAG for business FAQs and policies.

## 🚀 Features

- **WhatsApp Integration**: Full integration with Meta WhatsApp Business Cloud API
- **AI-Powered Conversations**: Natural language processing for booking requests
- **Appointment Management**: Create, reschedule, and cancel appointments
- **Multi-Service Support**: Handle different services with varying durations and prices
- **Availability Checking**: Real-time slot availability validation
- **Admin Dashboard**: RESTful API endpoints for business management
- **Customer Management**: Automatic customer profile creation and management
- **Conversation Memory**: Context-aware conversations using in-memory storage
- **Business Hours**: Configurable working hours and service availability
- **Confirmation Codes**: Unique codes for each appointment
- **Reminder System**: Automated appointment reminders
- **RAG Answers (Optional)**: Retrieval-Augmented replies from a business knowledge base (FAQs/policies) using embeddings
  **AI**: OpenAI GPT-4o-mini for natural language processing + OpenAI embeddings via LangChain

## 🛠 Technology Stack

- **Backend**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **AI**: OpenAI GPT-4o-mini for natural language processing
- **WhatsApp**: Meta WhatsApp Business Cloud API
- **Memory**: In-memory conversation context (can be extended to Redis)
- **Development**: Ngrok for webhook testing

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v16 or higher)
- MongoDB (v5 or higher)
- Ngrok (for local development)
- WhatsApp Business Account
- OpenAI API Account

## 🔧 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/spark-whatsapp-ai.git
cd spark-whatsapp-ai
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

Provide a MongoDB connection string (local or Atlas). The app will auto-seed a default Business record on first run.

### 4. Environment Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit the `.env` file with your configurations:

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Database (MongoDB)
MONGODB_URI=mongodb://localhost:27017/spark_whatsapp_ai

# WhatsApp Business Cloud API
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_verify_token

# OpenAI API
OPENAI_API_KEY=your_openai_api_key

# Business Configuration
BUSINESS_NAME=Spark Beauty Salon
BUSINESS_TIMEZONE=Africa/Nairobi
```

### 5. WhatsApp Business API Setup

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a new app and add WhatsApp Business product
3. Get your access token and phone number ID
4. Set up your webhook URL (use ngrok for local development)

### 6. Start the Application

For development:

```bash
npm run dev
```

For production:

```bash
npm start
```

### 7. Set Up Ngrok (Development)

In a separate terminal:

```bash
ngrok http 3000
```

Copy the HTTPS URL and update your `.env` file:

```bash
NGROK_URL=https://your-random-string.ngrok.io
```

Use this URL in your WhatsApp webhook configuration.

## 📱 WhatsApp Setup

### Webhook Configuration

1. In your Meta app dashboard, configure the webhook:

   - Webhook URL: `https://your-ngrok-url.ngrok.io/webhook`
   - Verify Token: Your `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to `messages` events

2. Verify the webhook by clicking "Verify and save"

### Test Your Setup

Send a message to your WhatsApp Business number to test the integration.

## 🎯 Usage Examples

### Customer Interactions

**Booking a new appointment:**

```
Customer: "Hi, I want to book a manicure"
Bot: "Hello! I'd be happy to help you book an appointment. 😊

      What service would you like to book?

      • Manicure
      • Pedicure
      • Facial Treatment
      • Hair Cut
      • Hair Styling
      • Massage"

Customer: "Manicure"
Bot: "Great choice! Manicure takes 60 minutes and costs KSH 2500.

     What date would you prefer? You can say things like 'tomorrow', 'Monday', or give me a specific date."

Customer: "Tomorrow at 2pm"
Bot: "Perfect! ✅ Your appointment is confirmed!

     📋 **Appointment Details:**
     • Service: Manicure
     • Date: December 16th, 2024
     • Time: 2:00 PM
     • Duration: 60 minutes
     • Price: KSH 2500
     • Confirmation Code: ABC123"
```

**Rescheduling:**

```
Customer: "I need to reschedule my appointment"
Bot: "I can help you reschedule your Manicure appointment on December 16th at 2:00 PM.

     What new date and time would you prefer?"
```

**Cancelling:**

```
Customer: "Cancel my appointment"
Bot: "Are you sure you want to cancel your Manicure appointment on December 16th at 2:00 PM?

     Reply 'yes' to confirm or 'no' to keep the appointment."
```

## 🔌 API Endpoints

### Admin Dashboard

#### Get Dashboard Overview

```http
GET /admin/dashboard
```

#### Get All Appointments

```http
GET /admin/appointments?page=1&limit=20&status=confirmed
```

#### Get Appointment by ID

```http
GET /admin/appointments/:id
```

#### Update Appointment Status

```http
PATCH /admin/appointments/:id/status
Content-Type: application/json

{
  "status": "cancelled",
  "reason": "Customer request"
}
```

#### Get Available Slots

```http
GET /admin/availability/2024-12-16?service=Manicure
```

#### Get All Customers

```http
GET /admin/customers?page=1&limit=20&search=john
```

#### Get Business Configuration

```http
GET /admin/business
```

#### Get Aggregated Stats

```http
GET /admin/stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

#### Send Reminders for Tomorrow

```http
POST /admin/maintenance/reminders
```

#### Update Appointment Statuses (mark yesterday no-shows)

```http
POST /admin/maintenance/update-statuses
```

### Webhook Endpoints

#### WhatsApp Webhook (Meta verification)

```http
GET /webhook?hub.mode=subscribe&hub.verify_token=your_token&hub.challenge=challenge
```

#### WhatsApp Webhook (Receive messages)

```http
POST /webhook
```

#### Test Endpoint (Development)

```http
POST /webhook/test
Content-Type: application/json

{
  "phone": "254712345678",
  "message": "I want to book a manicure"
}
```

## 🗂 Project Structure

```
spark-whatsapp-ai/
├── config/
│   └── database.js          # Database configuration and setup
├── model/
│   ├── Appointment.js       # Appointment model and methods
│   ├── Business.js          # Business model and configuration
│   ├── Customer.js          # Customer model and management
│   └── FAQChunk.js          # Knowledge base chunks with embeddings
├── routes/
│   ├── admin.js             # Admin dashboard endpoints
│   ├── webhook.js           # WhatsApp webhook handlers
│   └── business.js          # Business KB endpoints (add/list FAQ items)
├── services/
│   ├── aiService.js         # OpenAI integration and conversation logic
│   ├── bookingService.js    # Appointment booking business logic
│   ├── whatsappService.js   # WhatsApp API integration
│   └── vectorService.js     # Embedding & vector search (in-memory index)
├── .env.example             # Environment variables template
├── package.json             # Dependencies and scripts
├── README.md               # This file
└── server.js               # Main application entry point
```

## ⚙️ Configuration

### Business Configuration

The system automatically creates a default business configuration on first startup. You can modify this in `config/database.js`:

```javascript
{
  name: 'Spark Beauty Salon',
  working_hours: {
    monday: { open: '09:00', close: '18:00', closed: false },
    tuesday: { open: '09:00', close: '18:00', closed: false },
    // ... other days
  },
  services: [
    { name: 'Manicure', duration: 60, price: 2500 },
    { name: 'Pedicure', duration: 90, price: 3000 },
    // ... other services
  ],
  buffer_time: 15, // minutes between appointments
  advance_booking_days: 30,
  cancellation_hours: 24
}
```

### AI Behavior

Modify the system prompt in `services/aiService.js` to customize the AI assistant's personality and responses.

### RAG Knowledge Base

Use the following endpoints to manage a business knowledge base:

- Add/Update FAQ/Policy chunk (auto-embeds):

  POST `/business/:id/faq`
  Body: `{ "title": "Cancellation Policy", "text": "Cancellations must be made 24 hours in advance...", "source": "policy.md" }`

- List FAQ/Policy items:

  GET `/business/:id/faq`

On general questions, the assistant retrieves top relevant chunks and answers using that context. For production, replace the in-memory vector index in `services/vectorService.js` with Pinecone or pgvector.

## 🚀 Deployment

### Production Deployment Options

1. **Heroku**

   - Add PostgreSQL add-on
   - Set environment variables
   - Deploy with Git

2. **DigitalOcean App Platform**

   - Connect GitHub repository
   - Add managed PostgreSQL database
   - Configure environment variables

3. **AWS/GCP/Azure**
   - Use managed PostgreSQL service
   - Deploy on container service or VM
   - Set up proper networking and security

### Environment Variables for Production

```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:port/database
WHATSAPP_ACCESS_TOKEN=your_production_token
OPENAI_API_KEY=your_openai_key
```

## 🔍 Monitoring and Logging

The application includes comprehensive logging:

- ✅ Successful operations
- ❌ Error conditions
- 📩 Incoming messages
- 📤 Outgoing responses
- 📅 Appointment operations

Monitor logs in production:

```bash
# View logs
tail -f logs/app.log

# PM2 (if using)
pm2 logs spark-whatsapp-ai
```

## 🧪 Testing

### Manual Testing

1. Use the test endpoint:

```bash
curl -X POST http://localhost:3000/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"phone": "254712345678", "message": "I want to book a manicure"}'
```

2. Send messages to your WhatsApp Business number

### Database Testing

Check your appointments:

```bash
psql -d spark_whatsapp_ai -c "SELECT * FROM appointments;"
```

## 🛡 Security Considerations

1. **Environment Variables**: Never commit `.env` file to version control
2. **Webhook Verification**: Always verify WhatsApp webhook signatures in production
3. **Rate Limiting**: Implement rate limiting for API endpoints
4. **Input Validation**: Validate all user inputs
5. **Database Security**: Use connection pooling and prepared statements
6. **HTTPS**: Always use HTTPS in production

## 📈 Scaling

### Performance Optimization

1. **Database Indexing**: Ensure proper indexes on frequently queried fields
2. **Connection Pooling**: Configure appropriate pool sizes
3. **Caching**: Implement Redis for conversation memory
4. **Queue System**: Use job queues for background tasks

### Horizontal Scaling

1. **Load Balancer**: Distribute traffic across multiple instances
2. **Database Clustering**: Use PostgreSQL clustering
3. **Microservices**: Split into separate services if needed

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Troubleshooting

### Common Issues

1. **Database Connection Failed**

   - Check PostgreSQL is running
   - Verify connection credentials
   - Ensure database exists

2. **WhatsApp Webhook Verification Failed**

   - Check verify token matches
   - Ensure ngrok is running and URL is correct
   - Verify webhook endpoint is accessible

3. **OpenAI API Errors**

   - Check API key is valid
   - Verify sufficient credits
   - Check rate limits

4. **No Response from Bot**
   - Check webhook is receiving messages
   - Verify AI service is processing correctly
   - Check WhatsApp API credentials

### Debug Mode

Enable debug logging:

```bash
NODE_ENV=development npm run dev
```

### Health Checks

Check system health:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/admin/health
```

## 📞 Support

For support and questions:

- 📧 Email: support@sparkwhatsappai.com
- 📱 WhatsApp: +254700000000
- 🐛 Issues: GitHub Issues page

---

**Built with ❤️ for businesses in Kenya and beyond**
# WhatsApp-booking-bot-with-RAG-and-Redis
