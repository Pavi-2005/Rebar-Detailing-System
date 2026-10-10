import express from 'express';
import { createColumnDesign } from '../controllers/columnController.js';

const router = express.Router();

router.post('/design', createColumnDesign);

export default router;