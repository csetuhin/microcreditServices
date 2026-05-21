import { Router } from 'express';
import { DropoutController } from './controllers/DropoutController.js';

const router = Router();
const dropoutController = new DropoutController();

router.post('/dropout/all', dropoutController.handleAllDropouts);
router.post('/dropout/:brCode', dropoutController.handleDropout);

export default router;
