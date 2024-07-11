const express = require('express');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const port = 3000;

const dbURI = process.env.MONGO_URI;
mongoose.connect(dbURI, { useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Error connecting to MongoDB:', err));

const fileSchema = new mongoose.Schema({
  filename: String,
  uuid: String,
  uploadDate: { type: Date, default: Date.now },
  expirationDate: Date,
  password: String
});

const File = mongoose.model('File', fileSchema);

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|pdf|zip|rar|7z/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb('Error: Only images, PDFs, ZIP, RAR, and 7Z files are allowed!');
    }
  }
}).single('myFile');

app.use(express.static('./public'));
app.use(express.urlencoded({ extended: true }));

app.get('/download/:uuid', async (req, res) => {
  try {
    const file = await File.findOne({ uuid: req.params.uuid });
    if (file) {
      if (new Date() > file.expirationDate) {
        return res.status(404).send('File has expired.');
      }
      if (file.password) {
        res.send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Password Required</title>
              <link rel="stylesheet" href="/styles.css">
          </head>
          <body>
              <div class="container">
                  <form class="password-form" action="/download/${file.uuid}" method="post">
                      <label for="password">Password:</label>
                      <input type="password" name="password" required>
                      <button type="submit">Download</button>
                  </form>
              </div>
          </body>
          </html>
        `);
      } else {
        const filePath = path.join(__dirname, 'uploads', file.filename);
        res.download(filePath);
      }
    } else {
      res.status(404).send('File not found');
    }
  } catch (err) {
    res.status(500).send('Error downloading file.');
  }
});

app.post('/download/:uuid', async (req, res) => {
  try {
    const file = await File.findOne({ uuid: req.params.uuid });
    if (file) {
      if (new Date() > file.expirationDate) {
        return res.status(404).send('File has expired.');
      }
      if (file.password && file.password !== req.body.password) {
        return res.status(401).send('Incorrect password.');
      }
      const filePath = path.join(__dirname, 'uploads', file.filename);
      res.download(filePath);
    } else {
      res.status(404).send('File not found');
    }
  } catch (err) {
    res.status(500).send('Error downloading file.');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/upload', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      res.send(err.message);
    } else {
      const uuid = uuidv4();
      const expirationTime = parseInt(req.body.expiration);
      const expirationDate = new Date(Date.now() + expirationTime * 1000);
      const newFile = new File({ 
        filename: req.file.filename, 
        uuid, 
        expirationDate, 
        password: req.body.password || null 
      });
      await newFile.save();
      res.send(`File uploaded successfully! Download link: <a href="/download/${uuid}">Download</a>`);
    }
  });
});

// Cron job to delete expired files every hour
cron.schedule('0 * * * *', async () => {
  try {
    const expiredFiles = await File.find({ expirationDate: { $lt: new Date() } });
    for (const file of expiredFiles) {
      const filePath = path.join(__dirname, 'uploads', file.filename);
      fs.unlink(filePath, async (err) => {
        if (!err) {
          await File.deleteOne({ _id: file._id });
          console.log(`Deleted expired file: ${file.filename}`);
        }
      });
    }
  } catch (err) {
    console.error('Error deleting expired files:', err);
  }
});

app.listen(port, () => {
  console.log(`Server started on http://localhost:${port}`);
});
