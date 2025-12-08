import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

router.post('/login', async (req, res) => {
    try {
        const { license } = req.body;

        if (!license) {
            return res.status(400).json({ success: false, error: 'Licencia requerida' });
        }

        const [users] = await pool.query(
            `SELECT UserID, usName, usLicence, usStatus, usValidity, usCompanies, DatabaseID 
             FROM akUsers 
             WHERE usLicence = ? AND usStatus = 1 
             LIMIT 1`,
            [license]
        );

        if (!users || users.length === 0) {
            return res.status(401).json({ success: false, error: 'Licencia no válida o inactiva.' });
        }

        const user = users[0];

        if (user.usValidity) {
            const expiry = new Date(user.usValidity);
            if (expiry < new Date()) {
                return res.status(403).json({ success: false, error: 'Su licencia ha caducado.' });
            }
        }

        const userPrefix = user.DatabaseID ? user.DatabaseID.substring(0, 3).toUpperCase() : 'UNK';
        let organizationName = userPrefix;

        try {
            const [orgs] = await pool.query(
                `SELECT daClientName FROM daDashboard WHERE daClientPrefix = ? LIMIT 1`,
                [userPrefix]
            );
            if (orgs.length > 0) {
                organizationName = orgs[0].daClientName;
            } else if (user.usCompanies && user.usCompanies !== 'Todos') {
                organizationName = user.usCompanies;
            }
        } catch (err) {
            console.error('Error obteniendo organización:', err);
        }

        const token = jwt.sign(
            {
                id: user.UserID,
                name: user.usName,
                prefix: userPrefix,
                mode: 'corporate'
            },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        console.log(`✅ [Auth] Usuario: ${user.usName} | Org: ${organizationName} | Licencia: ${user.usLicence}`);

        res.json({
            success: true,
            token,
            user: {
                name: user.usName,
                prefix: userPrefix,
                license: user.usLicence,
                organization: organizationName
            }
        });
    } catch (error) {
        console.error('🔥 Error en /auth/login:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

export default router;
