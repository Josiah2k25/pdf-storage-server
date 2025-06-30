// server.js - Updated for AWS SDK v3 and S3 Storage
const express = require('express');
const multer = require('multer');
const { 
  S3Client, 
  HeadBucketCommand, 
  PutObjectCommand, 
  GetObjectCommand, 
  ListObjectsV2Command, 
  DeleteObjectCommand 
} = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure AWS S3 Client
const s3Client = new S3Client({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: process.env.AWS_REGION || 'us-east-1'
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'your-pdf-bucket-name';

// Enable CORS for your frontend
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } 
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'PDF Storage Server Running on AWS S3 (SDK v3)',
    timestamp: new Date().toISOString(),
    bucket: BUCKET_NAME
  });
});

// Test S3 connection
app.get('/test-s3', async (req, res) => {
  try {
    const command = new HeadBucketCommand({ Bucket: BUCKET_NAME });
    await s3Client.send(command);
    res.json({ status: 'S3 connection successful', bucket: BUCKET_NAME });
  } catch (error) {
    res.status(500).json({ 
      error: 'S3 connection failed', 
      message: error.message,
      bucket: BUCKET_NAME 
    });
  }
});

// Upload PDF endpoint (file upload)
app.post('/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    // Generate unique ID and filenames
    const uniqueId = crypto.randomUUID();
    const pdfKey = `pdfs/${uniqueId}.pdf`;
    const metadataKey = `metadata/${uniqueId}.json`;

    // Create metadata
    const metadata = {
      id: uniqueId,
      originalName: req.body.originalName || 'purchase-agreement.pdf',
      buyerName: req.body.buyerName || 'Unknown',
      uploadDate: new Date().toISOString(),
      fileSize: req.file.size,
      contentType: req.file.mimetype
    };

    // Upload PDF to S3
    const pdfUploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: pdfKey,
      Body: req.file.buffer,
      ContentType: 'application/pdf',
      ContentDisposition: `inline; filename="${metadata.originalName}"`,
      CacheControl: 'public, max-age=31536000' // Cache for 1 year
    });

    // Upload metadata to S3
    const metadataUploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: metadataKey,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json'
    });

    // Perform both uploads
    await Promise.all([
      s3Client.send(pdfUploadCommand),
      s3Client.send(metadataUploadCommand)
    ]);

    // Create public URL
    const publicUrl = `${req.protocol}://${req.get('host')}/pdf/${uniqueId}`;
    
    res.json({
      success: true,
      url: publicUrl,
      id: uniqueId,
      metadata: metadata
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload PDF', details: error.message });
  }
});

// Upload PDF via base64 (main endpoint for frontend)
app.post('/upload-pdf-base64', async (req, res) => {
  try {
    const { pdfData, buyerName, originalName } = req.body;

    if (!pdfData) {
      return res.status(400).json({ error: 'No PDF data provided' });
    }

    // Remove data URL prefix if present and convert to buffer
    const base64Data = pdfData.replace(/^data:application\/pdf;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique ID and filenames
    const uniqueId = crypto.randomUUID();
    const pdfKey = `pdfs/${uniqueId}.pdf`;
    const metadataKey = `metadata/${uniqueId}.json`;

    // Create metadata
    const metadata = {
      id: uniqueId,
      originalName: originalName || 'purchase-agreement.pdf',
      buyerName: buyerName || 'Unknown',
      uploadDate: new Date().toISOString(),
      fileSize: buffer.length,
      contentType: 'application/pdf'
    };

    // Upload PDF to S3
    const pdfUploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: pdfKey,
      Body: buffer,
      ContentType: 'application/pdf',
      ContentDisposition: `inline; filename="${metadata.originalName}"`,
      CacheControl: 'public, max-age=31536000'
    });

    // Upload metadata to S3
    const metadataUploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: metadataKey,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json'
    });

    // Perform both uploads
    await Promise.all([
      s3Client.send(pdfUploadCommand),
      s3Client.send(metadataUploadCommand)
    ]);

    // Create public URL
    const publicUrl = `${req.protocol}://${req.get('host')}/pdf/${uniqueId}`;
    
    res.json({
      success: true,
      url: publicUrl,
      id: uniqueId,
      metadata: metadata
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload PDF', details: error.message });
  }
});

// Serve PDF files from S3
app.get('/pdf/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pdfKey = `pdfs/${id}.pdf`;
    const metadataKey = `metadata/${id}.json`;

    // Get PDF from S3
    const pdfCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: pdfKey
    });

    // Check if PDF exists and get it
    const pdfObject = await s3Client.send(pdfCommand);

    // Try to get metadata for filename
    let filename = 'document.pdf';
    try {
      const metadataCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: metadataKey
      });
      const metadataObject = await s3Client.send(metadataCommand);
      
      // Convert stream to string for v3
      const metadataBody = await streamToString(metadataObject.Body);
      const metadata = JSON.parse(metadataBody);
      filename = metadata.originalName || 'document.pdf';
    } catch (metadataError) {
      console.log('No metadata found, using default filename');
    }

    // Convert stream to buffer for v3
    const pdfBuffer = await streamToBuffer(pdfObject.Body);

    // Set proper headers
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'public, max-age=31536000',
      'Content-Length': pdfBuffer.length
    });

    // Send the PDF
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Serve PDF error:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    res.status(500).json({ error: 'Failed to serve PDF', details: error.message });
  }
});

// Get PDF metadata
app.get('/pdf/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const metadataKey = `metadata/${id}.json`;

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: metadataKey
    });

    const object = await s3Client.send(command);
    
    // Convert stream to string for v3
    const metadataBody = await streamToString(object.Body);
    const metadata = JSON.parse(metadataBody);
    
    res.json(metadata);

  } catch (error) {
    console.error('Metadata error:', error);
    
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'PDF metadata not found' });
    }
    
    res.status(500).json({ error: 'Failed to get PDF metadata', details: error.message });
  }
});

// List all PDFs 
app.get('/admin/pdfs', async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'metadata/',
      MaxKeys: 1000
    });

    const objects = await s3Client.send(command);
    
    const pdfs = await Promise.all(
      (objects.Contents || []).map(async (object) => {
        try {
          const getCommand = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: object.Key
          });
          const metadataObject = await s3Client.send(getCommand);
          
          const metadataBody = await streamToString(metadataObject.Body);
          const metadata = JSON.parse(metadataBody);
          
          return {
            ...metadata,
            url: `${req.protocol}://${req.get('host')}/pdf/${metadata.id}`
          };
        } catch (error) {
          console.error('Error reading metadata:', error);
          return null;
        }
      })
    );

    // Filter out nulls and sort by upload date
    const validPdfs = pdfs
      .filter(pdf => pdf !== null)
      .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    res.json({ pdfs: validPdfs, total: validPdfs.length });

  } catch (error) {
    console.error('List PDFs error:', error);
    res.status(500).json({ error: 'Failed to list PDFs', details: error.message });
  }
});

app.delete('/admin/pdf/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pdfKey = `pdfs/${id}.pdf`;
    const metadataKey = `metadata/${id}.json`;

    // Delete both PDF and metadata
    const deleteCommands = [
      new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: pdfKey }),
      new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: metadataKey })
    ];

    await Promise.all(deleteCommands.map(command => s3Client.send(command)));

    res.json({ success: true, message: 'PDF deleted successfully', id });

  } catch (error) {
    console.error('Delete PDF error:', error);
    res.status(500).json({ error: 'Failed to delete PDF', details: error.message });
  }
});

// Helper functions for AWS SDK v3 stream handling
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function streamToString(stream) {
  const buffer = await streamToBuffer(stream);
  return buffer.toString('utf-8');
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error', details: error.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`PDF Storage Server running on port ${PORT}`);
  console.log(`Using S3 bucket: ${BUCKET_NAME}`);
  console.log(`Health check: http://localhost:${PORT}/`);
});
