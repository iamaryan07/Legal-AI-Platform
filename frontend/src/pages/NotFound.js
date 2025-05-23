import React from 'react';

const NotFound = () => {
    return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
            <h2>404 - Page Not Found</h2>
            <p>The page you're looking for doesn't exist.</p>
            <a href="/">Go back to home</a>
        </div>
    );
};

export default NotFound;
