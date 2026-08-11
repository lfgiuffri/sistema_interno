import { check } from "express-validator";
import { validator } from "../../../middlewares/validator.js";

export const  validateId = [
  check("id").exists().isMongoId(),
  (req, res, next) => {
    validator(req, res, next);
  },
];