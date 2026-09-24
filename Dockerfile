# Stage 1: Build the frontend and install production dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors
COPY package*.json ./
COPY server/package*.json ./server/

# Install dependencies for root and server
RUN npm ci
RUN cd server && npm ci

# Copy source files
COPY . .

# Build frontend production bundle (dist/)
RUN npm run build

# Stage 2: Minimal production runtime image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8000

# Copy root and server package files
COPY package*.json ./
COPY server/package*.json ./server/

# Install only production dependencies in server
RUN cd server && npm ci --only=production

# Copy built frontend bundle from builder stage
COPY --from=builder /app/dist ./dist

# Copy server code
COPY server ./server

EXPOSE 8000

# Start production server
CMD ["node", "server/index.js"]
