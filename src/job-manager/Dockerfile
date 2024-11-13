FROM node:20-slim

# context is parent
WORKDIR /app

# Copy package files
COPY package*.json ./

RUN npm ci

# Copy source code
COPY src/job-manager ./job-manager

WORKDIR /app/job-manager

# Expose port for health checks
EXPOSE 80

# Start the service
CMD ["npm", "run", "start-manager"]