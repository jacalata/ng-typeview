import {readFileSync} from "fs";
import * as ts from "typescript";
import {Option, Vector, Tuple2} from "prelude.ts";

/**
 * return a pair:
 * fst => the body of the interface (source code of the implementation)
 * snd => generic type parameters for the interface, or "". (For instance "<T0, T1>")
 *
 * The thinking for the generic type parameters is that you may have a
 * generic scope which doesn't care which is the T. In that case we can type-check
 * against any T. If you do care about the T, you can subclass the scope type to
 * a concrete type.
 */
function parseScopeInterface(iface: ts.InterfaceDeclaration): Option<Tuple2<string,string>> {
    const typeParamsInfo = () =>
        Option.of(iface.typeParameters)
        .filter(p => p.length > 0)
        .map(p => "<" + p.map((_,idx)=> "T" + idx).join(", ") + ">")
        .getOrElse("") ;
    return Option.of(iface.getText())
        .filter(_ => iface.name.getText() === "Scope")
        .map(cts => Tuple2.of(cts, typeParamsInfo()));
}

const maybeNodeType = <T extends ts.Node> (sKind: ts.SyntaxKind) => (input: ts.Node|undefined): Option<T> => {
    return (input && input.kind === sKind) ? Option.of(<T><any>input) : Option.none<T>();
}

/**
 * @hidden
 */
export function maybeSingleNode<T extends ts.Node>(nodes: ts.NodeArray<T>|undefined): Option<T> {
    if (nodes && nodes.length === 1) {
        return Option.of(nodes[0]);
    }
    return Option.none<T>();
}

/**
 * @hidden
 */
export const maybeCallExpression = maybeNodeType<ts.CallExpression>(ts.SyntaxKind.CallExpression);
/**
 * @hidden
 */
export const maybePropertyAccessExpression = maybeNodeType<ts.PropertyAccessExpression>(ts.SyntaxKind.PropertyAccessExpression);
/**
 * @hidden
 */
export const maybePropertyAssignment = maybeNodeType<ts.PropertyAssignment>(ts.SyntaxKind.PropertyAssignment);
/**
 * @hidden
 */
export const maybeIdentifier = maybeNodeType<ts.Identifier>(ts.SyntaxKind.Identifier);
/**
 * @hidden
 */
export const maybeStringLiteral = maybeNodeType<ts.StringLiteral>(ts.SyntaxKind.StringLiteral);
/**
 * @hidden
 */
export const maybeObjectLiteralExpression = maybeNodeType<ts.ObjectLiteralExpression>(ts.SyntaxKind.ObjectLiteralExpression);
/**
 * @hidden
 */
export const maybeVariableStatement = maybeNodeType<ts.VariableStatement>(ts.SyntaxKind.VariableStatement);
/**
 * @hidden
 */
export const maybeArrowFunction = maybeNodeType<ts.ArrowFunction>(ts.SyntaxKind.ArrowFunction);
/**
 * @hidden
 */
export const maybeFunctionExpression = maybeNodeType<ts.FunctionExpression>(ts.SyntaxKind.FunctionExpression);
/**
 * @hidden
 */
export const maybeBlock = maybeNodeType<ts.Block>(ts.SyntaxKind.Block);
/**
 * @hidden
 */
export const maybeReturnStatement = maybeNodeType<ts.ReturnStatement>(ts.SyntaxKind.ReturnStatement);
/**
 * @hidden
 */
export const maybeAsExpression = maybeNodeType<ts.AsExpression>(ts.SyntaxKind.AsExpression);
/**
 * @hidden
 */
export const maybeArrayLiteralExpression = maybeNodeType<ts.ArrayLiteralExpression>(ts.SyntaxKind.ArrayLiteralExpression);

/**
 * Returned by [[ControllerViewConnector.getControllerView]]
 * Describes a connection between a controller (TS file)
 * and a view (HTML file).
 */
export interface ControllerViewInfo {
    /**
     * Name of an angular controller
     */
    readonly controllerName: string;
    /**
     * Path to an angular view (file name within the project,
     * NOT absolute path on disk).
     */
    readonly viewPath: string;
}

/**
 * Returned by [[ModelViewConnector.getControllerView]]
 * Describes a connection between a controller or directive (TS file
 * containing a scope), and a view (HTML file).
 */
export interface ModelViewInfo {
    /**
     * Path to a file containing an angular controller scope
     * (can be a controller or a directive, the important thing
     * is that it contains the scope to use for the view)
     */
    readonly modelPath: string;
    /**
     * Path to an angular view (file name within the project,
     * NOT absolute path on disk).
     */
    readonly viewPath: string;
}

function objectLiteralGetProperty(
    propName: string, elts: Vector<ts.ObjectLiteralElementLike>): Option<ts.Node> {
    return elts.find(elt => maybeIdentifier(elt.name).filter(i => i.text === propName).isSome());
}

function getFieldStringLiteralValue(field: ts.Node): Option<string> {
    return maybePropertyAssignment(field)
        .flatMap(pa => maybeStringLiteral(pa.initializer))
        .map(ini => ini.text);
}

function objectLiteralGetStringLiteralField(
    propName: string, elts: Vector<ts.ObjectLiteralElementLike>): Option<string> {
    return objectLiteralGetProperty(propName, elts)
        .flatMap(p => getFieldStringLiteralValue(p));
}

function parseModalOpen(callExpr : ts.CallExpression): Option<ControllerViewInfo> {
    const paramObjectElements = Option.of(callExpr)
        .filter(c => ["$modal.open", "this.$modal.open"]
                .indexOf(c.expression.getText()) >= 0)
        .flatMap(c => maybeSingleNode(c.arguments))
        .flatMap(a => maybeObjectLiteralExpression(a))
        .map(o => Vector.ofIterable(o.properties));

    const getField = (name: string): Option<string> =>
        paramObjectElements.flatMap(oe => objectLiteralGetStringLiteralField(name, oe));

    const controllerName = getField("controller");
    const rawViewPath = getField("templateUrl");

    const buildCtrlViewInfo = (rawViewPath:string,ctrlName:string):ControllerViewInfo =>
        ({controllerName: ctrlName, viewPath: rawViewPath});

    return Option.liftA2(buildCtrlViewInfo)(rawViewPath, controllerName);
}

function parseModuleState(prop : ts.ObjectLiteralExpression): Option<ControllerViewInfo> {
    const objectLiteralFields = Vector.ofIterable(prop.properties)
        .mapOption(e => maybeIdentifier(e.name))
        .map(i => i.text);
    if ((objectLiteralFields.contains("url")) &&
        (objectLiteralFields.contains("templateUrl")) &&
        (objectLiteralFields.contains("controller"))) {
        // seems like I got a state controller/view declaration
        const controllerName = objectLiteralGetStringLiteralField(
            "controller", Vector.ofIterable(prop.properties));
        const rawViewPath = objectLiteralGetStringLiteralField(
            "templateUrl", Vector.ofIterable(prop.properties));

        const buildCtrlViewInfo = (rawViewPath:string, ctrlName:string):ControllerViewInfo =>
            ({controllerName: ctrlName, viewPath: rawViewPath});
        return Option.liftA2(buildCtrlViewInfo)(rawViewPath, controllerName);
    }
    return Option.none<ControllerViewInfo>();
}

function parseAngularModule(expr: ts.ExpressionStatement): Option<[string,string]> {
    const callExpr = maybeCallExpression(expr.expression);
    const prop0 = callExpr
        .flatMap(callExpr => maybePropertyAccessExpression(callExpr.expression));

    const prop = prop0
        .flatMap(callProp => maybeCallExpression(callProp.expression))
        .flatMap(callPropCall => maybePropertyAccessExpression(callPropCall.expression));

    const receiver1 = prop
        .flatMap(p => maybeIdentifier(p.expression))
        .map(r => r.text);
    const call1 = prop
        .flatMap(p => maybeIdentifier(p.name))
        .map(r => r.text);

    if (receiver1.filter(v => v === "angular")
        .orElse(call1.filter(v => v === "module")).isSome()) {
        const moduleCall = prop0.map(p => p.name.text);
        if (moduleCall.filter(v => v === "controller").isSome()) {
            const ctrlName = callExpr
                .filter(c => c.arguments.length > 0)
                .flatMap(c => maybeStringLiteral(c.arguments[0]))
                .map(a => a.text);
            const moduleName = prop0
                .flatMap(p => maybeCallExpression(p.expression))
                .filter(c => c.arguments.length > 0)
                .flatMap(c => maybeStringLiteral(c.arguments[0]))
                .map(s => s.text);
            const buildModuleCtrl: ((x:string, y:string) => [string,string]) = (mod, ctrl) => [mod, ctrl];
            return Option.liftA2(buildModuleCtrl)(moduleName, ctrlName);
        }
    }
    return Option.none<[string,string]>();
}

function getPropertyByName(objLit: ts.ObjectLiteralExpression,
                           propName: string): Option<ts.ObjectLiteralElementLike> {
    return Option.of(
        objLit.properties
            .find(p => maybeIdentifier(p.name).filter(i => i.getText() === propName).isSome()));
}

function parseAngularDirectiveTemplate(modelPath: string, callExpr: ts.CallExpression): Option<ModelViewInfo> {
    const prop0 =  maybePropertyAccessExpression(callExpr.expression);

    const prop = prop0
        .flatMap(callProp => maybeCallExpression(callProp.expression))
        .flatMap(callPropCall => maybePropertyAccessExpression(callPropCall.expression));

    const receiver1 = prop
        .flatMap(p => maybeIdentifier(p.expression))
        .map(r => r.text);
    const call1 = prop
        .flatMap(p => maybeIdentifier(p.name))
        .map(r => r.text);

    if (receiver1.filter(v => v === "angular")
        .orElse(call1.filter(v => v === "module")).isSome()) {
        const moduleCall = prop0.map(p => p.name.text);
        if (moduleCall.filter(v => v === "directive").isSome()) {
            const directiveParam = Option.of(callExpr)
                .filter(c => c.arguments.length > 1)
                .map(c => c.arguments[1]);

            const returnExpr = directiveParam
                .flatMap(maybeArrayLiteralExpression)
                .filter(l => l.elements.length > 0)
                .map(l => l.elements[l.elements.length-1])
                .orElse(directiveParam);

            const arrowBodyExpr = returnExpr
                .flatMap(maybeArrowFunction)
                .flatMap(a => maybeBlock(a.body));
            const fnBodyExpr = returnExpr
                .flatMap(maybeFunctionExpression)
                .map(fn => fn.body);
            const bodyExpr = arrowBodyExpr.orElse(fnBodyExpr);

            const resultExpr = bodyExpr
                .flatMap(b => maybeReturnStatement(b.statements[b.statements.length-1]))
                .flatMap(s => Option.of(s.expression));

            const scopeObject = resultExpr
                .flatMap(maybeAsExpression)
                .map(a => a.expression)
                .orElse(resultExpr);

            const templateUrl = scopeObject
                .flatMap(maybeObjectLiteralExpression)
                .flatMap(e => getPropertyByName(e ,"templateUrl"))
                .flatMap(maybePropertyAssignment)
                .flatMap(a => maybeStringLiteral(a.initializer))
                .map(s => s.text);
            return templateUrl.map(viewPath => ({modelPath, viewPath}));
        }
    }
    return Option.none<ModelViewInfo>();
}

/**
 * @hidden
 */
export interface ViewInfo {
    readonly fileName: string;
    readonly ngModuleName: Option<string>;
    readonly controllerName: Option<string>;
    readonly controllerViewInfos: ControllerViewInfo[];
    readonly modelViewInfos: ModelViewInfo[];
}

/**
 * You can register such a connector using [[ProjectSettings.ctrlViewConnectors]].
 * Will be called when parsing typescript files, allows you to tell ng-typeview
 * about connections between controllers and views made in your code, for instance
 * if you wrapped `$modal.open()` through your own helper classes or things like that.
 * For an example, check `ctrlViewConn` in `test/controller-parser.ts`.
 */
export interface ControllerViewConnector {
    /**
     * Which AST node you want to be listening for
     */
    interceptAstNode: ts.SyntaxKind;
    /**
     * When your view connector is registered and we parse a TS file and
     * ecounter an AST node with the type you specified through [[interceptAstNode]],
     * this function will be called.
     * @param node the AST node which matched your specification
     * @param projectPath the path of the project on disk
     * @returns the controller-view connections that you detected for this node,
     *     if any (the empty array if you didn't detect any).
     */
    getControllerView: (node: ts.Node, projectPath: string) => ControllerViewInfo[];
}

/**
 * You can register such a connector using [[ProjectSettings.modelViewConnectors]].
 * Will be called when parsing typescript files, allows you to tell ng-typeview
 * about connections between scopes and views made in your code (whether the scope
 * is defined in a controller or a directive for instance).
 */
export interface ModelViewConnector {
    /**
     * Which AST node you want to be listening for
     */
    interceptAstNode: ts.SyntaxKind;
    /**
     * When your view connector is registered and we parse a TS file and
     * ecounter an AST node with the type you specified through [[interceptAstNode]],
     * this function will be called.
     * @param filename the typescript file name
     * @param node the AST node which matched your specification
     * @param projectPath the path of the project on disk
     * @returns the controller-view connections that you detected for this node,
     *     if any (the empty array if you didn't detect any).
     */
    getModelView: (filename: string, node: ts.Node, projectPath: string) => ModelViewInfo[];
}

const modalOpenViewConnector : ControllerViewConnector = {
    interceptAstNode: ts.SyntaxKind.CallExpression,
    getControllerView: (node, projectPath) =>
        parseModalOpen(<ts.CallExpression>node).toVector().toArray()
};

const moduleStateViewConnector: ControllerViewConnector = {
    interceptAstNode: ts.SyntaxKind.ObjectLiteralExpression,
    getControllerView: (node, projectPath) =>
        parseModuleState(<ts.ObjectLiteralExpression>node).toVector().toArray()
};

const directiveViewConnector: ModelViewConnector = {
    interceptAstNode: ts.SyntaxKind.CallExpression,
    getModelView: (filename, node, projectPath) =>
        parseAngularDirectiveTemplate(filename, <ts.CallExpression>node).toVector().toArray()
};

/**
 * Default set of [[ControllerViewConnector]] which can recognize connections between
 * angular controllers and views from the typescript source.
 * You can give this list in [[ProjectSettings.ctrlViewConnectors]], or you can add
 * your own or provide your own list entirely.
 */
export const defaultCtrlViewConnectors = [modalOpenViewConnector, moduleStateViewConnector];

/**
 * Default set of [[ModelViewConnector]] which can recognize connections between
 * angular models (contained in controller or directives) and views from the typescript source.
 * You can give this list in [[ProjectSettings.modelViewConnectors]], or you can add
 * your own or provide your own list entirely.
 */
export const defaultModelViewConnectors = [directiveViewConnector];

/**
 * @hidden
 */
export function extractCtrlViewConnsAngularModule(
    fileName: string, webappPath: string,
    ctrlViewConnectors: ControllerViewConnector[],
    modelViewConnectors: ModelViewConnector[]): Promise<ViewInfo> {
    const sourceFile = ts.createSourceFile(
        fileName, readFileSync(fileName).toString(),
        ts.ScriptTarget.ES2016, /*setParentNodes */ true);
    let ngModuleName = Option.none<string>();
    let controllerName = Option.none<string>();
    let controllerViewInfos: ControllerViewInfo[] = [];
    let modelViewInfos: ModelViewInfo[] = [];
    return new Promise<ViewInfo>((resolve, reject) => {
        function nodeExtractModuleOpenAngularModule(node: ts.Node) {
            if (controllerName.isNone() && node.kind == ts.SyntaxKind.ExpressionStatement) {
                const mCtrlNgModule = parseAngularModule(<ts.ExpressionStatement>node);
                ngModuleName = mCtrlNgModule.map(moduleCtrl => moduleCtrl[0]);
                controllerName = mCtrlNgModule.map(moduleCtrl => moduleCtrl[1]);
            }
            controllerViewInfos = controllerViewInfos.concat(
                Vector.ofIterable(ctrlViewConnectors)
                    .filter(conn => conn.interceptAstNode === node.kind)
                    .flatMap(conn => Vector.ofIterable(conn.getControllerView(node, webappPath)))
                    .toArray());
            modelViewInfos = modelViewInfos.concat(
                Vector.ofIterable(modelViewConnectors)
                    .filter(conn => conn.interceptAstNode === node.kind)
                    .flatMap(conn => Vector.ofIterable(conn.getModelView(fileName, node, webappPath)))
                    .toArray());
            ts.forEachChild(node, nodeExtractModuleOpenAngularModule);
        }
        nodeExtractModuleOpenAngularModule(sourceFile);
        resolve({fileName, ngModuleName, controllerName, controllerViewInfos, modelViewInfos});
    });
}

/**
 * @hidden
 */
export interface ControllerScopeInfo {
    readonly tsModuleName: Option<string>;
    /**
     * body of the interface for the scope
     */
    readonly scopeInfo: Option<string>;
    /**
     * type parameters for the scope, like "<T0,T1>" or ""
     */
    readonly scopeTypeParams: Option<string>;
    readonly typeAliases: string[];
    readonly imports: string[];
    readonly importNames: string[];
    readonly nonExportedDeclarations: string[];
    readonly viewFragments: string[];
}

function nodeIsExported(node: ts.Node): boolean {
    return Option.of(node.modifiers)
        .filter(modifiers => modifiers.some(
            modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
        .isSome();
}

/**
 * You can register such an extractor using [[ProjectSettings.ctrlViewFragmentExtractors]].
 * Will be called when parsing typescript files, allows you to tell ng-typeview
 * about view fragments present in your controllers, for instance ng-grid has
 * 'cell templates' which typeview can also type-check through this mechanism.
 */
export interface CtrlViewFragmentExtractor {
    /**
     * Which AST node you want to be listening for
     */
    interceptAstNode: ts.SyntaxKind;
    /**
     * When your view connector is registered and we parse a TS file and
     * ecounter an AST node with the type you specified through [[interceptAstNode]],
     * this function will be called.
     * @param node the AST node which matched your specification
     * @returns the view fragments that you detected for this node,
     *     if any (the empty array if you didn't detect any).
     */
    getViewFragments: (node: ts.Node) => string[];
}

/**
 * Default set of controller view fragment extractors (currently empty)
 */
export const defaultCtrlViewFragmentExtractors: CtrlViewFragmentExtractor[] = [];

/**
 * @hidden
 */
export function extractControllerScopeInfo(
      fileName: string,
      ctrlViewFragmentExtractors: CtrlViewFragmentExtractor[]): Promise<ControllerScopeInfo> {
    const sourceFile = ts.createSourceFile(
        fileName, readFileSync(fileName).toString(),
        ts.ScriptTarget.ES2016, /*setParentNodes */ true);
    return new Promise<ControllerScopeInfo>((resolve, reject) => {
        let scopeInfo = Option.none<string>();
        let scopeTypeParams = Option.none<string>();
        let tsModuleName:string|undefined = undefined;
        let typeAliases:string[] = [];
        let imports:string[] = [];
        let importNames:string[] = [];
        let nonExportedDeclarations:string[] = [];
        let viewFragments:string[] = [];
        function nodeExtractScopeInterface(node: ts.Node) {
            // so that the viewtest file may compile, we must copy
            // in it classes & interfaces that may have been declared
            // privately in the controller. We do limit ourselves to
            // top-level declarations on which the Scope type declaration
            // may depend, that's why we check whether they're under the
            // module block. if there is no TS module and declarations are
            // toplevel then no need to copy them as they were global anyway.
            if (node.parent &&
                node.parent.kind === ts.SyntaxKind.ModuleBlock &&
                !nodeIsExported(node)) {
                if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
                    const curIntfInfo = parseScopeInterface(<ts.InterfaceDeclaration>node);
                    if (curIntfInfo.isSome()) {
                        scopeInfo = curIntfInfo.map(x => x.fst());
                        scopeTypeParams = curIntfInfo.map(x => x.snd());
                    } else {
                        nonExportedDeclarations.push(node.getText());
                    }
                }
                if (node.kind === ts.SyntaxKind.ClassDeclaration) {
                    nonExportedDeclarations.push(node.getText());
                }
                if (node.kind === ts.SyntaxKind.VariableStatement) {
                    nonExportedDeclarations.push(node.getText());
                }
                if (node.kind === ts.SyntaxKind.EnumDeclaration) {
                    nonExportedDeclarations.push(node.getText());
                }
            }
            if (node.kind === ts.SyntaxKind.ModuleDeclaration) {
                const moduleLevel = (<ts.StringLiteral>(<ts.ModuleDeclaration>node).name).text;
                if (tsModuleName) {
                    tsModuleName += "." + moduleLevel;
                } else {
                    tsModuleName = moduleLevel;
                }
            }
            if (node.kind === ts.SyntaxKind.TypeAliasDeclaration && !nodeIsExported(node)) {
                typeAliases.push(node.getText());
            }
            if (node.kind === ts.SyntaxKind.ImportEqualsDeclaration) {
                imports.push(node.getText());
                importNames.push((<ts.ImportEqualsDeclaration>node).name.getText());
            }
            const ctrlViewFragments = Vector.ofIterable(ctrlViewFragmentExtractors)
                .filter(extractor => extractor.interceptAstNode === node.kind)
                .flatMap(extractor => Vector.ofIterable(extractor.getViewFragments(node)));
            viewFragments = viewFragments.concat(ctrlViewFragments.toArray());
            ts.forEachChild(node, nodeExtractScopeInterface);
        }
        nodeExtractScopeInterface(sourceFile);
        resolve({
            tsModuleName: Option.of<string>(tsModuleName),
            scopeInfo, scopeTypeParams, typeAliases, imports, importNames,
            nonExportedDeclarations, viewFragments
        });
    });
}
