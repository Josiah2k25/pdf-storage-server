// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for your frontend
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create pdfs directory if it doesn't exist
const pdfDir = path.join(__dirname, 'pdfs');
if (!fs.existsSync(pdfDir)) {
  fs.mkdirSync(pdfDir, { recursive: true });
}

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'PDF Storage Server Running',
    timestamp: new Date().toISOString()
  });
});

// Upload PDF endpoint
app.post('/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    // Generate unique filename
    const uniqueId = crypto.randomUUID();
    const filename = `${uniqueId}.pdf`;
    const filepath = path.join(pdfDir, filename);

    // Save PDF to disk
    fs.writeFileSync(filepath, req.file.buffer);

    // Create metadata
    const metadata = {
      id: uniqueId,
      originalName: req.body.originalName || 'purchase-agreement.pdf',
      buyerName: req.body.buyerName || 'Unknown',
      uploadDate: new Date().toISOString(),
      fileSize: req.file.size
    };

    // Save metadata
    const metadataPath = path.join(pdfDir, `${uniqueId}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Return the public URL
    const publicUrl = `${req.protocol}://${req.get('host')}/pdf/${uniqueId}`;
    
    res.json({
      success: true,
      url: publicUrl,
      id: uniqueId,
      metadata: metadata
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload PDF' });
  }
});

// Alternative endpoint for base64 PDF data
app.post('/upload-pdf-base64', async (req, res) => {
  try {
    const { pdfData, buyerName, originalName } = req.body;

    if (!pdfData) {
      return res.status(400).json({ error: 'No PDF data provided' });
    }

    // Remove data URL prefix if present
    const base64Data = pdfData.replace(/^data:application\/pdf;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
    const uniqueId = crypto.randomUUID();
    const filename = `${uniqueId}.pdf`;
    const filepath = path.join(pdfDir, filename);

    // Save PDF to disk
    fs.writeFileSync(filepath, buffer);

    // Create metadata
    const metadata = {
      id: uniqueId,
      originalName: originalName || 'purchase-agreement.pdf',
      buyerName: buyerName || 'Unknown',
      uploadDate: new Date().toISOString(),
      fileSize: buffer.length
    };

    // Save metadata
    const metadataPath = path.join(pdfDir, `${uniqueId}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Return the public URL
    const publicUrl = `${req.protocol}://${req.get('host')}/pdf/${uniqueId}`;
    
    res.json({
      success: true,
      url: publicUrl,
      id: uniqueId,
      metadata: metadata
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload PDF' });
  }
});

// Serve PDF files
app.get('/pdf/:id', (req, res) => {
  try {
    const { id } = req.params;
    const filepath = path.join(pdfDir, `${id}.pdf`);
    const metadataPath = path.join(pdfDir, `${id}.json`);

    // Check if PDF exists
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    // Get metadata if available
    let metadata = {};
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    }

    // Set proper headers
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${metadata.originalName || 'document.pdf'}"`,
      'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
    });

    // Send the PDF
    res.sendFile(filepath);

  } catch (error) {
    console.error('Serve PDF error:', error);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// Get PDF metadata
app.get('/pdf/:id/info', (req, res) => {
  try {
    const { id } = req.params;
    const metadataPath = path.join(pdfDir, `${id}.json`);

    if (!fs.existsSync(metadataPath)) {
      return res.status(404).json({ error: 'PDF metadata not found' });
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    res.json(metadata);

  } catch (error) {
    console.error('Metadata error:', error);
    res.status(500).json({ error: 'Failed to get PDF metadata' });
  }
});

// List all PDFs (optional admin endpoint)
app.get('/admin/pdfs', (req, res) => {
  try {
    const files = fs.readdirSync(pdfDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const metadata = JSON.parse(fs.readFileSync(path.join(pdfDir, file), 'utf8'));
        return {
          ...metadata,
          url: `${req.protocol}://${req.get('host')}/pdf/${metadata.id}`
        };
      })
      .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    res.json({ pdfs: files, total: files.length });

  } catch (error) {
    console.error('List PDFs error:', error);
    res.status(500).json({ error: 'Failed to list PDFs' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`PDF Storage Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/`);
});
