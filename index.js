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

    // role middlewares
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await userCollection.findOne({ email })
      if (user?.role !== 'admin')
        return res
          .status(403)
          .send({ message: 'Admin only Actions!', role: user?.role })

      next()
    }
    const verifyDecorator = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await userCollection.findOne({ email })
      if (user?.role !== 'decorator')
        return res
          .status(403)
          .send({ message: 'Decorator only Actions!', role: user?.role })

      next()
    }

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
    app.post('/service',verifyJWT,verifyADMIN, async (req, res) => { //use jwt 
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
    app.delete('/services/:id',verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.deleteOne(query);
      res.send(result);
    })

    //put/edit a service by admin by
    app.put('/services/:id',verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
      const id = req.params.id;
      const serviceData = req.body;
      // console.log(serviceData);
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

    // // GET all bookings for a specific customer
    // app.get("/bookings",verifyJWT, async (req, res) => {   //use jwt
    //   const bookings = await bookingsCollection
    //     .find({ "customer.email": req.tokenEmail })
    //     .sort({ createdAt: -1 })
    //     .toArray();

    //   res.send(bookings);
    // });

    // GET bookings for logged-in customer with pagination & status filter
    app.get("/bookings", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const status = req.query.status || "all";

        const skip = (page - 1) * limit;

        const query = { "customer.email": email };
        if (status !== "all") {
          query.bookingStatus = status;
        }

        const total = await bookingsCollection.countDocuments(query);

        const bookings = await bookingsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          bookings,
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to load bookings" });
      }
    });


    // DELETE BOOKING
    app.delete("/bookings/cancel/:id", async (req, res) => {  //also use anmin or customer
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
    app.get("/payments/history",verifyJWT, async (req, res) => {  //use jwt
      const result = await bookingsCollection
        .find({ "customer.email": req.tokenEmail, payment: true })
        .toArray();

      res.send(result);
    });

    //get single service for services details page
    app.get('/services/:id', async (req, res) => {  //not needed to verify  //this is also edit admin
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    })


    //for admin 
    //manage decorator
    // GET all customers
    app.get("/users/customer",verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
      const result = await userCollection.find({ role: "customer" }).toArray();
      res.send(result);
    });

    // GET all decorators and login get working project and complete project help to manage deorator page
    app.get("/users/decorator",verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
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
    app.patch("/users/promote/:id",verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
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
    app.patch("/users/demote/:id",verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
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

    // ADMIN GET BOOKINGS (pagination + filter)
    app.get("/admin/bookings", verifyJWT,verifyADMIN, async (req, res) => { //use jwt
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const status = req.query.status || "all";
        const payment = req.query.payment || "all";

        const skip = (page - 1) * limit;

        const query = {};

        // STATUS FILTER
        if (status !== "all") {
          query.bookingStatus = status;
        }

        // PAYMENT FILTER
        if (payment !== "all") {
          query.payment = payment === "paid";
        }

        const total = await bookingsCollection.countDocuments(query);

        const bookings = await bookingsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          bookings,
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to load admin bookings" });
      }
    });


    //aftar asign decorator
    app.patch("/admin/bookings/assign/:id",verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
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

    //for analysis
    // admin sumery 
    app.get("/admin/analytics/summary",verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
      try {
        const bookings = await bookingsCollection.find().toArray();

        let totalRevenue = 0;
        let unpaidAmount = 0;
        let totalBookings = bookings.length;
        let workingOn = 0;
        let completed = 0;
        let unpaidCount = 0;

        bookings.forEach((b) => {
          if (b.payment) {
            totalRevenue += b.cost;
          } else {
            unpaidAmount += b.cost;
            unpaidCount++;
          }

          if ([
            "assigned",
            "planning_phase",
            "materials_prepared",
            "ona_the_way",
            "setup_in_progress"
          ].includes(b.bookingStatus)) {
            workingOn++;
          }

          if (b.bookingStatus === "completed") {
            completed++;
          }
        });

        res.send({
          totalRevenue,
          totalBookings,
          workingOn,
          completed,
          unpaidAmount,
          unpaidCount
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load revenue summary" });
      }
    });

    // SERVICE DEMAND CHART
    app.get("/admin/analytics/service-demand",verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
      try {
        const result = await bookingsCollection.aggregate([
          {
            $group: {
              _id: "$serviceName",
              totalBookings: { $sum: 1 }
            }
          },
          {
            $project: {
              _id: 0,
              serviceName: "$_id",
              totalBookings: 1
            }
          },
          { $sort: { totalBookings: -1 } }
        ]).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to load service demand data" });
      }
    });

    //STATUS DISTRIBUTION
    app.get("/admin/analytics/status-distribution",verifyJWT,verifyADMIN, async (req, res) => {  //use jwt
      try {
        const result = await bookingsCollection.aggregate([
          {
            $group: {
              _id: "$bookingStatus",
              count: { $sum: 1 }
            }
          },
          {
            $project: {
              _id: 0,
              status: "$_id",
              count: 1
            }
          }
        ]).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to load status data" });
      }
    });


    //decorator
    // Get assigned projects for decorator
    app.get("/decorator/projects",verifyJWT,verifyDecorator, async (req, res) => {  //use jwt

      const result = await bookingsCollection.find({
        "assignedDecorator.email": req.tokenEmail,
        bookingStatus: { $ne: "cancelled" }
      }).toArray();

      res.send(result);
    });

    //update project status
    app.patch("/decorator/projects/status/:id",verifyJWT,verifyDecorator, async (req, res) => {  //use jwt
      const id = req.params.id;
      const { status } = req.body;

      await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { bookingStatus: status } }
      );

      res.send({ success: true });
    });

    //today shedule
    app.get("/decorator/bookings",verifyJWT,verifyDecorator, async (req, res) => { //use jwt

      const result = await bookingsCollection.find({
        "assignedDecorator.email": req.tokenEmail
      }).toArray();

      res.send(result);
    });

    //earning sumery
    app.get("/decorator/earnings",verifyJWT,verifyDecorator, async (req, res) => { //use jwt
      try {
        const email = req.tokenEmail;

        if (!email) {
          return res.status(400).send({ message: "Decorator email required" });
        }

        const bookings = await bookingsCollection.find({
          "assignedDecorator.email": email
        }).toArray();

        let totalEarnings = 0;
        let monthlyEarnings = 0;
        let completedCount = 0;
        let pendingEarnings = 0;

        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();

        bookings.forEach(b => {
          const amount = b.cost || 0;

          if (b.bookingStatus === "completed") {
            totalEarnings += amount;
            completedCount++;

            const completedDate = new Date(b.bookingDate);
            if (
              completedDate.getMonth() === currentMonth &&
              completedDate.getFullYear() === currentYear
            ) {
              monthlyEarnings += amount;
            }
          }

          if (
            [
              "assigned",
              "planning_phase",
              "materials_prepared",
              "ona_the_way",
              "setup_in_progress"
            ].includes(b.bookingStatus)
          ) {
            pendingEarnings += amount;
          }
        });

        res.send({
          totalEarnings,
          monthlyEarnings,
          completedCount,
          pendingEarnings,
          bookings
        });

      } catch (err) {
        res.status(500).send({ message: "Failed to load earnings data" });
      }
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


    //all requarement done 

    //for get role based user
    //get a user role 
    app.get('/user/role', verifyJWT, async (req, res) => {
      // console.log(req.tokenEmail);
      const result = await userCollection.findOne({ email: req.tokenEmail })
      res.send({ role: result?.role })
    })


    //for home page get decorators
    app.get('/decorators', async (req, res) => {
      try {
        const result = await decoratorsCollection
          .find({ role: 'decorator' })        
          .sort({ createdAt: 1 })              
          .limit(3)                            
          .project({
            name: 1,
            email: 1,
            imageURL: 1,
            role: 1,
            createdAt: 1,
          })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to load decorators' });
      }
    })


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
