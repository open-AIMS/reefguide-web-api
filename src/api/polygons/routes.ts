import express from "express";
import { z } from "zod";
import { processRequest } from "zod-express-middleware";
import { prisma } from "../apiSetup";
import { passport } from "../auth/passportConfig";
import { userIsAdmin } from "../auth/utils";
import { NotFoundException, UnauthorizedException } from "../exceptions";
import { GeoJSONPolygonSchema } from "../../interfaces/GeoJSON";
require("express-async-errors");

const polygons = express.Router();

// Input validation schemas
const createPolygonSchema = z.object({
  polygon: GeoJSONPolygonSchema,
});

const updatePolygonSchema = z.object({
  polygon: GeoJSONPolygonSchema,
});

/** Get a specific polygon by ID */
polygons.get(
  "/:id",
  processRequest({ params: z.object({ id: z.string() }) }),
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    if (!req.user) {
      throw new UnauthorizedException();
    }

    const polygonId = req.params.id;

    const polygon = await prisma.polygon.findUnique({
      where: { id: parseInt(polygonId) },
    });

    if (!polygon) {
      throw new NotFoundException("Polygon not found");
    }

    if (!userIsAdmin(req.user) && polygon.user_id !== req.user.id) {
      throw new UnauthorizedException();
    }

    res.json({ polygon });
  }
);

/** Get all polygons for user, or all if admin */
polygons.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    if (!req.user) {
      throw new UnauthorizedException();
    }
    if (userIsAdmin(req.user)) {
      // Admin gets all
      res.json({ polygons: await prisma.polygon.findMany() });
      return;
    }
    // Normal users get only their own polygons
    res.json({
      polygons: await prisma.polygon.findMany({
        where: { user_id: req.user.id },
      }),
    });
  }
);

/** Create a new Polygon */
polygons.post(
  "/",
  processRequest({
    body: createPolygonSchema,
  }),
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    if (!req.user) {
      throw new UnauthorizedException();
    }
    const userId = req.user.id;
    const newPolygon = await prisma.polygon.create({
      data: {
        user_id: userId,
        polygon: req.body.polygon,
      },
    });
    res.status(201).json({
      polygon: newPolygon,
    });
  }
);

/** Update a Polygon */
polygons.put(
  "/:id",
  processRequest({
    params: z.object({ id: z.string() }),
    body: updatePolygonSchema,
  }),
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    if (!req.user) {
      throw new UnauthorizedException();
    }
    const polygonId = parseInt(req.params.id);
    const { polygon } = req.body;

    const existingPolygon = await prisma.polygon.findUnique({
      where: { id: polygonId },
    });

    if (!existingPolygon) {
      throw new NotFoundException("Polygon not found");
    }

    if (!userIsAdmin(req.user) && existingPolygon.user_id !== req.user.id) {
      throw new UnauthorizedException();
    }

    const updatedPolygon = await prisma.polygon.update({
      where: { id: polygonId },
      data: {
        polygon: polygon,
      },
    });

    res.json({ polygon: updatedPolygon });
  }
);

/** Delete a Polygon */
polygons.delete(
  "/:id",
  processRequest({ params: z.object({ id: z.string() }) }),
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    if (!req.user) {
      throw new UnauthorizedException();
    }
    const polygonId = parseInt(req.params.id);

    const existingPolygon = await prisma.polygon.findUnique({
      where: { id: polygonId },
    });

    if (!existingPolygon) {
      throw new NotFoundException("Polygon not found");
    }

    if (!userIsAdmin(req.user) && existingPolygon.user_id !== req.user.id) {
      throw new UnauthorizedException();
    }

    await prisma.polygon.delete({
      where: { id: polygonId },
    });

    res.status(204).send();
  }
);

export default polygons;
