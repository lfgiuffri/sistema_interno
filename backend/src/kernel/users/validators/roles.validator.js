import { check } from "express-validator";
import { validator } from "../../../middlewares/validator.js";

export const validateId = [
  check("id").exists().isInt(),
  (req, res, next) => {
    validator(req, res, next);
  },
];

export const validateCreateUpdate = [
  check("label").exists().notEmpty().isString().trim(),
  check("description").optional({ nullable: true }).isString(),
  check("capabilities").optional({ nullable: true }).isArray(),
  check("capabilities.*").isString(),
  (req, res, next) => {
    validator(req, res, next);
  },
];

export const validateQuery = [
  check("name").optional({ nullable: true }).isString(),
  check("limit").optional({ nullable: true }).isNumeric(),
  check("page").optional({ nullable: true }).isNumeric(),
  check("order").optional({ nullable: true }).isString(),
  check("order_type").optional({ nullable: true }).isString(),
  (req, res, next) => {
    validator(req, res, next);
  },
];
