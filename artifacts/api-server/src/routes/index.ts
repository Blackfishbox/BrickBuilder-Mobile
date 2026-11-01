import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ldrawRouter from "./ldraw";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ldrawRouter);

export default router;
