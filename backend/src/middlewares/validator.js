import { validationResult } from 'express-validator';
import { responseManager } from '../libs/responseManager.js';

export const validator = async (req, res, next) => {
    try {
        validationResult(req).throw();
        
        return next();
    } catch (error) {
        // 422 Unprocessable Entity es el código correcto para fallos de validación de input
        // (distinto de 400 Bad Request, que es para requests malformados a nivel protocolo).
        return await responseManager(422, error.array(), req, res, false);
    }
}
