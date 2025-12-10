import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const directLicense = req.headers['x-license-key'];

    req.userContext = { prefix: null, mode: 'guest', userId: null, userName: 'Invitado' };

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (!err) {
                req.userContext = {
                    prefix: decoded.prefix,
                    mode: 'corporate',
                    userId: decoded.id,
                    userName: decoded.name
                };
            }
            next();
        });
    } else if (directLicense && directLicense.length > 3) {
        req.userContext = {
            prefix: directLicense.substring(0, 3).toUpperCase(),
            mode: 'iframe_license',
            userId: null,
            userName: 'Usuario Externo'
        };
        next();
    } else {
        next();
    }
};