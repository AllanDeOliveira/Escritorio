const { requireUser } = require('./requireUser');

/** Como requireUser (sessão válida de usuário ativo), mas exige role === 'admin'. */
function requireAdmin(req, res, next) {
    return requireUser(req, res, () => {
        if (req.currentUser.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Acesso restrito a administradores' });
        }
        req.adminUser = req.currentUser;
        next();
    });
}

module.exports = { requireAdmin };
