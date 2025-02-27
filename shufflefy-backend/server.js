const express = require("express");
const cors = require("cors");
const axios = require("axios");
const SpotifyWebApi = require("spotify-web-api-node");
const session = require("express-session");
const path = require("path");
const pool = require('./db'); 

require('dotenv').config();

const app = express();
app.use(session({
    secret: process.env.SESSION_SECRET || 'default_secret', // Use an environment variable or default secret
    resave: false,
    saveUninitialized: true,
    //Secure means requires HTTPS, SET TRUE FOR DEPLOY
    cookie: { secure: false, httpOnly: true, sameSite: "Lax" }
}));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 5000;

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

// Step 1: Get authorisation code
app.get("/login", (req, res) => {
    console.log("login");
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${process.env.SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.SPOTIFY_REDIRECT_URI)}&scope=streaming user-read-email playlist-read-private user-read-private user-modify-playback-state&show_dialog=true`;
    
    res.redirect(authUrl); // Redirect the user to the Spotify authorization page

});

// Step 2: Get Spotify Auth Token
app.get("/callback", async (req, res) => {
    const { code } = req.query; // Get the authorization code from the query params

    if (code){
    try {
        const data = await spotifyApi.authorizationCodeGrant(code); // Exchange the code for tokens
        req.session.accessToken = data.body.access_token; // Access token
        const refreshToken = data.body.refresh_token; // Refresh token
        const expiresIn = data.body.expires_in; // Token expiration time
        const grantedScopes = data.body.scope; 
        
        //Store accessToken in frontend
        res.redirect(process.env.ROOT_URI + `/?accessToken=${req.session.accessToken}`);
    } catch (err) {
        console.error("Error logging in:", err);
        res.status(400).json({ error: "Authentication failed" });
    }
    } else{
        console.error("No auth code");
    }
});


// Step 2: Refresh Access Token
app.post("/refresh", async (req, res) => {
    const { refreshToken } = req.body;
    spotifyApi.setRefreshToken(refreshToken);
    try {
        const data = await spotifyApi.refreshAccessToken();
        res.json({ accessToken: data.body.access_token, expiresIn: data.body.expires_in });
    } catch (err) {
        console.error("Error refreshing token:", err);
        res.status(400).json({ error: "Could not refresh token" });
    }
});


// Fetch playlists from Spotify API
app.get('/playlists', async (req, res) => {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Missing access token' });
    }

    try {
        const response = await fetch('https://api.spotify.com/v1/me/playlists', {
            headers: {
                Authorization: `Bearer ${req.session.accessToken}`,
            },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Spotify API error: ${response.statusText}` });
        }

        const data = await response.json();
        res.json(data.items); // Send playlists to frontend
    } catch (error) {
        console.error("Error fetching playlists:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.post('/api/play-track', async (req, res) => {
    const { trackUri , deviceId} = req.body;

    try {
        const response = await axios.put(
            `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
            { uris: [trackUri] },
            {
                headers: {
                    'Authorization': `Bearer ${req.session.accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error playing track:', error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({ error: error.response?.data || 'Failed to play track' });
    }
});

app.post('/api/add-to-queue', async (req, res) => {
    const { trackUri } = req.body;;

    if (!trackUri) {
        return res.status(400).json({ error: 'Track URI is required' });
    }

    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/queue?uri=' + encodeURIComponent(trackUri), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${req.session.accessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to add track to queue' });
        }

        res.json({ message: 'Track added to queue' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/get-random-song', async (req, res) => {
    const { playlistId } = req.query;

    if (!playlistId) {
        return res.status(400).json({ error: 'Playlist ID is required' });
    }

    try {
        const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            headers: {
                Authorization: `Bearer ${req.session.accessToken}`,
            },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch playlist tracks' });
        }

        const data = await response.json();

        if (!data.items || data.items.length === 0) {
            return res.status(404).json({ error: 'No tracks found in the playlist' });
        }

        const randomTrack = data.items[Math.floor(Math.random() * data.items.length)];
        const trackUri = randomTrack.track.uri;

        res.json({ trackUri: trackUri });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get("/api/getUserId", async (req, res) => {
    console.error("Get userId");
    try {
        const response = await fetch("https://api.spotify.com/v1/me", {
            headers: {
                Authorization: `Bearer ${req.session.accessToken}`
            }
        })

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch userId' });
        }

        const data = await response.json();
        if (!data.id){
            return res.status(404).json({error: "No userId found"});
        }
        const userId = data.id;
        res.json({userId: userId});
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
})

app.post("/db/getUserPlaylistId", async (req,res) => {
    const {userId, playlistId} = req.body;

    try {
        const insertResult =  await pool.query(
            `INSERT INTO UserPlaylist (UserID, PlaylistID)
             VALUES ($1, $2)
             ON CONFLICT (UserID, PlaylistID) DO NOTHING;`,
            [userId, playlistId]
        );
        console.log("Insert results: ", insertResult);
    } catch (error) {
        console.error('Error inserting UserPlaylist:', error);
        res.status(500).json({ error: 'Database error' });
    }

    try {
        const queryText = `
            SELECT UserPlaylistID
            FROM UserPlaylist
            WHERE UserID = $1 AND PlaylistID = $2;
        `;
        const result = await pool.query(queryText, [userId, playlistId]);
        if (result.rows.length > 0) {
            res.json({userPlaylistId: result.rows[0].userplaylistid});
        } else {
            res.status(400).json({error: 'No userPlaylistId found'})
        }

        
    } catch (error) {
        console.error('Error fetching UserPlaylistId:', error);
        res.status(500).json({ error: 'Database error' });
    }

});

app.post("/db/addSongs", async (req,res) => {
    const {userId, playlistId} = req.body;

    try {
        const insertResult =  await pool.query(
            `INSERT INTO UserPlaylist (UserID, PlaylistID)
             VALUES ($1, $2)
             ON CONFLICT (UserID, PlaylistID) DO NOTHING;`,
            [userId, playlistId]
        );
        console.log("Insert results: ", insertResult);
    } catch (error) {
        console.error('Error inserting UserPlaylist:', error);
        res.status(500).json({ error: 'Database error' });
    }

    try {
        const queryText = `
            SELECT UserPlaylistID
            FROM UserPlaylist
            WHERE UserID = $1 AND PlaylistID = $2;
        `;
        const result = await pool.query(queryText, [userId, playlistId]);
        if (result.rows.length > 0) {
            res.json({userPlaylistId: result.rows[0].userplaylistid});
        } else {
            res.status(400).json({error: 'No userPlaylistId found'})
        }

        
    } catch (error) {
        console.error('Error fetching UserPlaylistId:', error);
        res.status(500).json({ error: 'Database error' });
    }

});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
