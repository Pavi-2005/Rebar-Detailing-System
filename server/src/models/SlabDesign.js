import mongoose from 'mongoose';

const slabDesignSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
  user: {
    email: { type: String, required: true },
    name: { type: String, required: true }
  },
  projectName: String,
  designerName: String,
  date: String,
  remarks: String,
  designType: String,
  inputValues: Object,
  result: Object,
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('SlabDesign', slabDesignSchema);
