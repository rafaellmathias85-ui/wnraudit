import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import tenantsRouter from "./tenants";
import scansRouter from "./scans";
import findingsRouter from "./findings";
import dashboardRouter from "./dashboard";
import firewallsRouter from "./firewalls";
import serversRouter from "./servers";
import oauthCallbackRouter from "./oauthCallback";
import inquiriesRouter from "./inquiries";
import usersRouter from "./users";
import externalRouter from "./external";
import securityCenterRouter from "./securityCenter";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(oauthCallbackRouter);
router.use(tenantsRouter);
router.use(inquiriesRouter);
router.use(scansRouter);
router.use(findingsRouter);
router.use(dashboardRouter);
router.use(firewallsRouter);
router.use(serversRouter);
router.use(usersRouter);
router.use(externalRouter);
router.use(securityCenterRouter);
router.use(reportsRouter);

export default router;
