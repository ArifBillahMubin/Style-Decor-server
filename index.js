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
    const decoratorsCollection = db.collection('decorators')

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

    // GET all bookings for a specific customer
    app.get("/bookings/:email", async (req, res) => {
      const email = req.params.email;
      const bookings = await bookingsCollection
        .find({ "customer.email": email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(bookings);
    });

    // DELETE BOOKING
    app.delete("/bookings/cancel/:id", async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount > 0) {
        return res.send({ success: true, message: "Booking deleted successfully" });
      }

      res.status(404).send({ success: false, message: "Booking not found" });
    });

    //get All PAID bookings for a customer
    app.get("/payments/history", async (req, res) => {
      const email = req.query.email;
      const result = await bookingsCollection
        .find({ "customer.email": email, payment: true })
        .toArray();

      res.send(result);
    });

    //get single service for services details page
    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    })


    //for admin 
    //manage decorator
    // GET all customers
    app.get("/users/customer", async (req, res) => {
      const result = await userCollection.find({ role: "customer" }).toArray();
      res.send(result);
    });

    // GET all decorators and login get working project and complete project help to manage deorator page
    app.get("/users/decorator", async (req, res) => {
      const decorators = await decoratorsCollection.find().toArray();

      const result = await Promise.all(
        decorators.map(async (decorator) => {

          const workingProjects = await bookingsCollection.countDocuments({
            "assignedDecorator.email": decorator.email,
            bookingStatus: {
              $in: [
                "assigned",
                "planning_phase",
                "materials_prepared",
                "ona_the_way",
                "setup_in_progress"
              ]
            }
          });

          const completedProjects = await bookingsCollection.countDocuments({
            "assignedDecorator.email": decorator.email,
            bookingStatus: "completed"
          });

          return {
            ...decorator,
            workingProjects,
            completedProjects
          };
        })
      );

      res.send(result);
    });

    // Promote customer to decorator
    app.patch("/users/promote/:id", async (req, res) => {
      const id = req.params.id;

      // Update role in user collection
      await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: "decorator" } }
      );

      // Find updated user data
      const user = await userCollection.findOne({ _id: new ObjectId(id) });

      // Insert into decorator collection
      await decoratorsCollection.updateOne(
        { userId: id },
        {
          $set: {
            userId: id,
            name: user?.name,
            email: user?.email,
            imageURL: user?.imageURL,
            role: "decorator",
            createdAt: new Date()
          }
        },
        { upsert: true }   // ensures no duplicates
      );

      res.send({ success: true, message: "User promoted to decorator" });
    });


    //demote decorator to customer
    app.patch("/users/demote/:id", async (req, res) => {
      const id = req.params.id;

      // Update role in users collection
      await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: "customer" } }
      );

      // Delete decorator record (string OR ObjectId)
      await decoratorsCollection.deleteOne({
        $or: [
          { userId: id },                         // if stored as string
          { userId: new ObjectId(id) }            // if stored as ObjectId
        ]
      });

      res.send({ success: true, message: "Decorator removed successfully" });
    });

    //admin get bookings
    app.get("/admin/bookings", async (req, res) => {
      const result = await bookingsCollection.find().toArray();
      res.send(result);
    });

    //aftar asign decorator
    app.patch("/admin/bookings/assign/:id", async (req, res) => {
      const { decoratorName, decoratorEmail } = req.body;
      await bookingsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $set: {
            assignedDecorator: {
              name: decoratorName,
              email: decoratorEmail,
            },
            bookingStatus: "assigned",
          },
        }
      );
      res.send({ success: true });
    });

    // Create Stripe checkout session
    app.post("/create-checkout-session", async (req, res) => {
      const info = req.body;

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
        cancel_url: `${process.env.DOMAIN_URL}/dashboard/my-bookings`,
      });

      res.send({ url: session.url });
    });

    // PAYMENT SUCCESS
    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;

      // retrieve checkout session info
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const {
        serviceId,
        bookingDate,
        location,
        customerEmail,
        customerName
      } = session.metadata;

      // find existing booking from DB
      const booking = await bookingsCollection.findOne({
        serviceId,
        "customer.email": customerEmail,
        bookingDate,
        location
      });

      if (!booking) {
        return res.send({
          success: false,
          message: "Booking not found"
        });
      }

      // update booking as paid
      const updated = await bookingsCollection.updateOne(
        { _id: booking._id },
        {
          $set: {
            payment: true,
            transactionId: session.payment_intent,
            paymentDate: new Date(),
          },
        }
      );

      res.send({
        success: true,
        message: "Payment updated successfully",
        bookingId: booking._id,
        transactionId: session.payment_intent,
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
