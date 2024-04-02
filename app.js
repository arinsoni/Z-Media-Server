const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { google } = require('googleapis');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const spreadsheetId = process.env.spreadsheet_Id
console.log(spreadsheetId)
const key = process.env.KEY_FILE


app.use(cors());
app.use(express.json());


const range = 'Sheet1!A:A'; 

async function authenticateWithGoogleSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: key, 
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  return sheets;
}





mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));


const cacheSchema = new mongoose.Schema({
  instagramUrl: { type: String, required: true, unique: true },
  downloadUrl: { type: String, required: true }
});


const Cache = mongoose.model('Cache', cacheSchema);



async function fetchAndCacheReelDownloadUrl(instagramUrl) {
  let cacheEntry = await Cache.findOne({ instagramUrl });
  if (cacheEntry) {
    return cacheEntry.downloadUrl;
  }

  const url = `https://instagram-post-reels-stories-downloader.p.rapidapi.com/instagram/?url=${encodeURIComponent(instagramUrl)}`;
  const options = {
    method: 'GET',
    headers: {
      'X-RapidAPI-Key': process.env.RAPID_API,
      'X-RapidAPI-Host': 'instagram-post-reels-stories-downloader.p.rapidapi.com'
    }
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    const downloadUrl = data.result[0].url;


    cacheEntry = new Cache({ instagramUrl, downloadUrl });
    await cacheEntry.save();

    return downloadUrl;
  } catch (error) {
    console.error(`Failed to fetch download URL for ${instagramUrl}:`, error);
    throw error;
  }
}


app.get('/video-proxy', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).send("URL is required");
  }

  try {
    const decodedUrl = decodeURIComponent(videoUrl);
    const videoResponse = await fetch(decodedUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);
    }
    res.setHeader('Content-Type', videoResponse.headers.get('Content-Type'));
    videoResponse.body.pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to fetch video');
  }
});


app.get('/getVideos', async (req, res) => {
  try {
    const videoUrls = await Cache.find({});
    res.json(videoUrls);
  } catch (error) {
    console.error('Failed to get video URLs:', error);
    res.status(500).send('Failed to get video URLs');
  }
});



app.get('/updateReelsCache', async (req, res) => {
  try {
    const sheets = await authenticateWithGoogleSheets();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const instagramReelUrls = response.data.values ? response.data.values.flat() : [];

    for (const url of instagramReelUrls) {
      await fetchAndCacheReelDownloadUrl(url);
    }

    res.send({ message: "Successfully updated cache with reel downloads." });
  } catch (error) {
    console.error("Failed to update cache:", error);
    res.status(500).send({ error: "Failed to update cache with reel downloads." });
  }
});


app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
