import request from 'supertest';
import app, { prisma } from '../src/api/apiSetup';
import {
  adminToken,
  clearDbs,
  user1Token,
  user2Token,
  userSetup,
} from './utils';
import { Express } from 'express';

beforeEach(async () => {
  // clear DB between all runs
  await clearDbs();
  // Re-setup users
  await userSetup();
});

afterAll(async () => {
  // clear when finished
  await clearDbs();
});

type TokenType = 'user1' | 'user2' | 'admin';

// Utility function to make authenticated requests
const authRequest = (app: Express, tokenType: TokenType = 'user1') => {
  const token =
    tokenType === 'user2'
      ? user2Token
      : tokenType === 'admin'
        ? adminToken
        : user1Token;

  return {
    get: (url: string) =>
      request(app)
        .get(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json'),

    post: (url: string) =>
      request(app)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json'),

    put: (url: string) =>
      request(app)
        .put(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json'),

    delete: (url: string) =>
      request(app)
        .delete(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json'),
  };
};

describe('API Routes', () => {
  let user1Id: number;
  let polygonId: number;
  let noteId: number;

  beforeEach(async () => {
    await clearDbs();
    await userSetup();

    // Get user1's ID
    const user1 = await prisma.user.findUnique({
      where: { email: 'user1@example.com' },
    });
    user1Id = user1!.id;

    // Create a polygon for user1
    const polygon = await prisma.polygon.create({
      data: {
        polygon: JSON.stringify({ type: 'Polygon', coordinates: [[]] }),
        user_id: user1Id,
      },
    });
    polygonId = polygon.id;

    // Create a note for the polygon
    const note = await prisma.polygonNote.create({
      data: {
        content: 'Test note',
        polygon_id: polygonId,
        user_id: user1Id,
      },
    });
    noteId = note.id;
  });

  afterAll(async () => {
    await clearDbs();
  });

  describe('API Routes', () => {
    describe('Health Check', () => {
      it('should return 200 for unauthenticated request', async () => {
        await request(app).get('/api').expect(200);
      });

      it('should return 200 for authenticated request', async () => {
        await authRequest(app, 'user1').get('/api').expect(200);
      });
    });

    describe('Authentication', () => {
      describe('POST /api/auth/register', () => {
        it('should register a new user', async () => {
          const res = await request(app)
            .post('/api/auth/register')
            .send({ email: 'newuser@example.com', password: 'password123' })
            .expect(201);

          expect(res.body).toHaveProperty('userId');
        });

        it('should return 400 for invalid input', async () => {
          await request(app)
            .post('/api/auth/register')
            .send({ email: 'invalidemail', password: 'short' })
            .expect(400);
        });

        it('should return 400 for existing email', async () => {
          await request(app)
            .post('/api/auth/register')
            .send({ email: 'user1@example.com', password: 'password123' })
            .expect(400);
        });
      });

      describe('POST /api/auth/login', () => {
        it('should login an existing user', async () => {
          const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'user1@example.com', password: 'password123' })
            .expect(200);

          expect(res.body).toHaveProperty('token');
        });

        it('should return 401 for invalid credentials', async () => {
          await request(app)
            .post('/api/auth/login')
            .send({ email: 'user1@example.com', password: 'wrongpassword' })
            .expect(401);
        });
      });

      describe('GET /api/auth/profile', () => {
        it('should return user profile for authenticated user', async () => {
          const res = await authRequest(app, 'user1')
            .get('/api/auth/profile')
            .expect(200);

          expect(res.body.user).toHaveProperty('email', 'user1@example.com');
        });

        it('should return 401 for unauthenticated request', async () => {
          await request(app).get('/api/auth/profile').expect(401);
        });
      });
    });

    describe('Polygons', () => {
      describe('GET /api/polygons', () => {
        it('should return all polygons for admin', async () => {
          const res = await authRequest(app, 'admin')
            .get('/api/polygons')
            .expect(200);

          expect(res.body.polygons).toBeInstanceOf(Array);
          expect(res.body.polygons.length).toBeGreaterThan(0);
        });

        it("should return only user's polygons for non-admin", async () => {
          const res = await authRequest(app, 'user1')
            .get('/api/polygons')
            .expect(200);

          expect(res.body.polygons).toBeInstanceOf(Array);
          expect(res.body.polygons.length).toBe(1);
        });

        it('should return empty array if user has no polygons', async () => {
          const res = await authRequest(app, 'user2')
            .get('/api/polygons')
            .expect(200);

          expect(res.body.polygons).toBeInstanceOf(Array);
          expect(res.body.polygons.length).toBe(0);
        });
      });

      describe('GET /api/polygons/:id', () => {
        it('should return a specific polygon for its owner', async () => {
          const res = await authRequest(app, 'user1')
            .get(`/api/polygons/${polygonId}`)
            .expect(200);

          expect(res.body.polygon).toHaveProperty('id', polygonId);
        });

        it('should return a specific polygon for admin', async () => {
          const res = await authRequest(app, 'admin')
            .get(`/api/polygons/${polygonId}`)
            .expect(200);

          expect(res.body.polygon).toHaveProperty('id', polygonId);
        });

        it('should return 401 if user is not the owner', async () => {
          await authRequest(app, 'user2')
            .get(`/api/polygons/${polygonId}`)
            .expect(401);
        });

        it('should return 404 for non-existent polygon', async () => {
          await authRequest(app, 'user1').get('/api/polygons/9999').expect(404);
        });
      });

      describe('POST /api/polygons', () => {
        it('should create a new polygon', async () => {
          const res = await authRequest(app, 'user1')
            .post('/api/polygons')
            .send({
              polygon: {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                  ],
                ],
              },
            })
            .expect(201);

          expect(res.body.polygon).toHaveProperty('id');
          expect(res.body.polygon).toHaveProperty('polygon');
        });

        it('should return 400 for invalid GeoJSON', async () => {
          await authRequest(app, 'user1')
            .post('/api/polygons')
            .send({ polygon: 'invalid' })
            .expect(400);
        });
      });

      describe('PUT /api/polygons/:id', () => {
        it('should update an existing polygon', async () => {
          const res = await authRequest(app, 'user1')
            .put(`/api/polygons/${polygonId}`)
            .send({
              polygon: {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0],
                    [2, 0],
                    [2, 2],
                    [0, 2],
                    [0, 0],
                  ],
                ],
              },
            })
            .expect(200);

          expect(res.body.polygon).toHaveProperty('id', polygonId);
          expect(res.body.polygon.polygon.coordinates[0].map((a : Array<number>) => a.toString())).toContain([2, 2].toString());
        });

        it('should return 401 if user is not the owner', async () => {
          await authRequest(app, 'user2')
            .put(`/api/polygons/${polygonId}`)
            .send({
              polygon: {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0],
                    [2, 0],
                    [2, 2],
                    [0, 2],
                    [0, 0],
                  ],
                ],
              },
            })
            .expect(401);
        });

        it('should return 404 for non-existent polygon', async () => {
          await authRequest(app, 'user1')
            .put('/api/polygons/9999')
            .send({
              polygon: {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0],
                    [2, 0],
                    [2, 2],
                    [0, 2],
                    [0, 0],
                  ],
                ],
              },
            })
            .expect(404);
        });
      });

      describe('DELETE /api/polygons/:id', () => {
        it('should delete an existing polygon', async () => {
          await authRequest(app, 'user1')
            .delete(`/api/polygons/${polygonId}`)
            .expect(204);

          // Verify the polygon is deleted
          await authRequest(app, 'user1')
            .get(`/api/polygons/${polygonId}`)
            .expect(404);
        });

        it('should return 401 if user is not the owner', async () => {
          await authRequest(app, 'user2')
            .delete(`/api/polygons/${polygonId}`)
            .expect(401);
        });

        it('should return 404 for non-existent polygon', async () => {
          await authRequest(app, 'user1')
            .delete('/api/polygons/9999')
            .expect(404);
        });
      });
    });

    describe('Notes', () => {
      describe('GET /api/notes', () => {
        it('should return all notes for admin', async () => {
          const res = await authRequest(app, 'admin')
            .get('/api/notes')
            .expect(200);

          expect(res.body.notes).toBeInstanceOf(Array);
          expect(res.body.notes.length).toBeGreaterThan(0);
        });

        it("should return only user's notes for non-admin", async () => {
          const res = await authRequest(app, 'user1')
            .get('/api/notes')
            .expect(200);

          expect(res.body.notes).toBeInstanceOf(Array);
          expect(res.body.notes.length).toBe(1);
        });

        it('should return empty array if user has no notes', async () => {
          const res = await authRequest(app, 'user2')
            .get('/api/notes')
            .expect(200);

          expect(res.body.notes).toBeInstanceOf(Array);
          expect(res.body.notes.length).toBe(0);
        });
      });

      describe('GET /api/notes/:id', () => {
        it('should return notes for a specific polygon (owner)', async () => {
          const res = await authRequest(app, 'user1')
            .get(`/api/notes/${polygonId}`)
            .expect(200);

          expect(res.body.notes).toBeInstanceOf(Array);
          expect(res.body.notes.length).toBe(1);
          expect(res.body.notes[0]).toHaveProperty('content', 'Test note');
        });

        it('should return notes for a specific polygon (admin)', async () => {
          const res = await authRequest(app, 'admin')
            .get(`/api/notes/${polygonId}`)
            .expect(200);

          expect(res.body.notes).toBeInstanceOf(Array);
          expect(res.body.notes.length).toBe(1);
        });

        it('should return 401 if user is not the owner', async () => {
          await authRequest(app, 'user2')
            .get(`/api/notes/${polygonId}`)
            .expect(401);
        });

        it('should return 404 for non-existent polygon', async () => {
          await authRequest(app, 'user1').get('/api/notes/9999').expect(404);
        });
      });

      describe('POST /api/notes', () => {
        it('should create a new note', async () => {
          const res = await authRequest(app, 'user1')
            .post('/api/notes')
            .send({
              content: 'New test note',
              polygonId: polygonId,
            })
            .expect(201);

          expect(res.body.note).toHaveProperty('id');
          expect(res.body.note).toHaveProperty('content', 'New test note');
        });

        it('should return 400 for invalid input', async () => {
          await authRequest(app, 'user1')
            .post('/api/notes')
            .send({ polygonId: polygonId })
            .expect(400);
        });

        it("should return 401 if user doesn't own the polygon", async () => {
          await authRequest(app, 'user2')
            .post('/api/notes')
            .send({
              content: 'Unauthorized note',
              polygonId: polygonId,
            })
            .expect(401);
        });
      });

      describe('PUT /api/notes/:id', () => {
        it('should update an existing note', async () => {
          const res = await authRequest(app, 'user1')
            .put(`/api/notes/${noteId}`)
            .send({ content: 'Updated test note' })
            .expect(200);

          expect(res.body.note).toHaveProperty('id', noteId);
          expect(res.body.note).toHaveProperty('content', 'Updated test note');
        });

        it('should return 401 if user is not the owner', async () => {
          await authRequest(app, 'user2')
            .put(`/api/notes/${noteId}`)
            .send({ content: 'Unauthorized update' })
            .expect(401);
        });

        it('should return 404 for non-existent note', async () => {
          await authRequest(app, 'user1')
            .put('/api/notes/9999')
            .send({ content: 'Non-existent note' })
            .expect(404);
        });
      });

      describe('DELETE /api/notes/:id', () => {
        it('should delete an existing note', async () => {
          await authRequest(app, 'user1')
            .delete(`/api/notes/${noteId}`)
            .expect(204);

          // Verify the note is deleted
          const notes = await prisma.polygonNote.findMany({
            where: { id: noteId },
          });
          expect(notes.length).toBe(0);
        });

        it('should return 401 if user is not the owner', async () => {
          await authRequest(app, 'user2')
            .delete(`/api/notes/${noteId}`)
            .expect(401);
        });

        it('should return 404 for non-existent note', async () => {
          await authRequest(app, 'user1').delete('/api/notes/9999').expect(404);
        });
      });
    });
  });
});
