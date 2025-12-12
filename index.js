require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const admin = require('firebase-admin')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()
// middleware
app.use(
  cors({
    origin: [
      process.env.DOMAIN_URL,
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})


async function run() {
  try {
    const db = client.db('styleDecor');
    const userCollection = db.collection('users')
    const servicesCollection = db.collection('services')
    const bookingsCollection = db.collection('bookings')

    //save and update user 
    app.post('/user', async (req, res) => {
      const userData = req.body

      userData.created_at = new Date().toISOString()
      userData.last_login = new Date().toISOString()
      userData.role = 'customer';

      const query = {
        email: userData.email
      }

      //already exists user
      const existingUser = await userCollection.findOne({ email: userData.email });
      if (existingUser) {
        const result = await userCollection.updateOne(query, {
          $set: {
            last_login: new Date().toISOString()
          }
        })

        return res.send(result);
      }

      const result = await userCollection.insertOne(userData)
      res.send(result);
    })

    // save a services data in db by admin
    app.post('/service', async (req, res) => {
      const serviceData = req.body;
      const result = await servicesCollection.insertOne(serviceData);
      res.send(result);
    })

    //get all services
    app.get('/services', async (req, res) => {
      const result = await servicesCollection.find().toArray();
      res.send(result);
    })

    //delete a service by admin
    app.delete('/services/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.deleteOne(query);
      res.send(result);
    })

    //put/edit a service by admin by
    app.put('/services/:id', async (req, res) => {
      const id = req.params.id;
      const serviceData = req.body;
      console.log(serviceData);
      // return res.send({acknowledged:true});
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          service_name: serviceData.service_name,
          category: serviceData.category,
          description: serviceData.description,
          cost: serviceData.cost,
          unit: serviceData.unit,
          image: serviceData.image,
          rating: serviceData.rating,
        },
      };
      const result = await servicesCollection.updateOne(filter, updateDoc);
      res.send(result);
    })

    // services filter, sort by rating for home page
    app.get("/services-home-filter", async (req, res) => {
      const limit = parseInt(req.query.limit) || 6;
      const sort = req.query.sort || "desc";

      let sortOption = {};
      if (sort === "rating") sortOption = { rating: -1 };

      const services = await servicesCollection
        .find({})
        .sort(sortOption)
        .limit(limit)
        .toArray();

      res.send({
        success: true,
        services,
      });
    });

    // services filter, search, sort, pagination for services page
    app.get("/services-filter", async (req, res) => {
      const {
        search = "",
        category = "",
        min = "",
        max = "",
        sort = "",
        page = 1,
      } = req.query;

      const limit = 8;
      const skip = (page - 1) * limit;

      // FILTER OBJECT
      const filter = {};

      if (search) {
        filter.service_name = { $regex: search, $options: "i" };
      }

      if (category) {
        filter.category = category;
      }

      if (min || max) {
        filter.cost = {};
        if (min) filter.cost.$gte = Number(min);
        if (max) filter.cost.$lte = Number(max);
      }

      // SORT OPTION
      const sortOption = {};
      if (sort === "asc") sortOption.cost = 1;
      if (sort === "desc") sortOption.cost = -1;

      // TOTAL COUNT + PAGINATION
      const totalCount = await servicesCollection.countDocuments(filter);
      const totalPages = Math.ceil(totalCount / limit);

      // FINAL QUERY
      const services = await servicesCollection
        .find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        services,
        totalPages,
      });
    });

    //save booking in db init state form service details page booking button
    app.post('/bookings', async (req, res) => {
      const bookingInfo = req.body;
      const result = await bookingsCollection.insertOne(bookingInfo);
      res.send(result);
    })

    //get single service for services details page
    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    })

    app.post("/create-checkout-session", async (req, res) => {
      const info = req.body;

      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: info.serviceName,          
                description: info.description,   
                images: [info.image],            
              },
              unit_amount: info.cost * 100,      
            },
            quantity: 1,
          },
        ],

        customer_email: info.customer?.email,
        mode: "payment",


        metadata: {
          serviceId: info.serviceId,
          serviceName: info.serviceName,
          category: info.category,
          unit: info.unit,
          rating: String(info.rating),   
          bookingDate: info.bookingDate,       
          location: info.location,             

          customerName: info.customer?.name,
          customerEmail: info.customer?.email,
        },

        success_url: `${process.env.DOMAIN_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.DOMAIN_URL}/services/${info.serviceId}`,
      });

      res.send({ url: session.url });
    });

    // PAYMENT SUCCESS 
    app.post('/payment-success', async (req, res) => {
      const { sessionId } = req.body;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const {
        serviceId,
        category,
        unit,
        rating,
        bookingDate,
        location,
        customerName,
        customerEmail
      } = session.metadata;

      // Find the service in DB
      const service = await servicesCollection.findOne({
        _id: new ObjectId(serviceId)
      });

      // Prevent duplicate orders
      const existingOrder = await bookingsCollection.findOne({
        transactionId: session.payment_intent
      });

      // When payment is completed and order does not already exist
      if (session.status === "complete" && service && !existingOrder) {
        const bookingInfo = {
          serviceId,
          serviceName: service.service_name,
          category,
          unit,
          rating: Number(rating),
          transactionId: session.payment_intent,
          customer: {
            name: customerName,
            email: customerEmail
          },
          status: "pending",
          price: session.amount_total / 100,
          image: service.image,
          location,
          bookingDate,
          createdAt: new Date()
        };

        // Store booking in DB
        const result = await bookingsCollection.insertOne(bookingInfo);

        return res.send({
          success: true,
          transactionId: session.payment_intent,
          bookingId: result.insertedId
        });
      }

      // If order exists, just return it
      res.send({
        success: true,
        transactionId: session.payment_intent,
        bookingId: existingOrder?._id
      });
    });


    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
