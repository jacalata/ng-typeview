import * as assert from 'assert'
import {Vector} from "prelude.ts";
import {addScopeAccessors} from '../src/view-ngexpression-parser'
import {NgScope} from "../src/view-parser"

describe("addScopeAccessors", () => {
    it ("should add $scope properly", () => {
        const fakeScopeInfo: Vector<NgScope> = Vector.of(
            {
                xpathDepth: 1,
                closeSource: ()=>"",
                variables: []
            },
            {
                xpathDepth: 2,
                closeSource: ()=>"",
                variables: []
            }
        );
        const assertScopeAcc = (expected:string,input:string) => assert.equal(
            expected, addScopeAccessors(fakeScopeInfo, input));
        assertScopeAcc("$scope.data.value", "data.value");
        assertScopeAcc("$scope.data.value !== undefined", "data.value !== undefined");
        assertScopeAcc("!$scope.wasProvidedWorkbook()", "!wasProvidedWorkbook()");
        assertScopeAcc("$scope.info.subscribedEmails.length > 0", "info.subscribedEmails.length > 0");
        assertScopeAcc("$scope.movieInfo.legendEnabled && $scope.movieInfo.legend.length > 0",
                       "movieInfo.legendEnabled && movieInfo.legend.length > 0");
        assertScopeAcc("$scope.selectedScreen.images[$scope.idx - 1] !== null",
                       "selectedScreen.images[idx - 1] !== null");
        assertScopeAcc("$scope.selectedScreen.images[$scope.idx - 1].name",
                       "selectedScreen.images[idx - 1].name");
        assertScopeAcc("$scope.getSelectedImage($scope.selectedScreen.images[$scope.idx - 1])",
                       "getSelectedImage(selectedScreen.images[idx - 1])");
        assertScopeAcc("$scope.fType === 'test' || $scope.fType === 'test1'",
                       "fType === 'test' || fType === 'test1'");
        assertScopeAcc("$scope.wasProvidedWorkbook ? '' : 'ng-invalid'",
                       "wasProvidedWorkbook ? '' : 'ng-invalid'");
        assertScopeAcc('{"internal-tab": true, "internal-active": $scope.idx === 0}',
                       '{"internal-tab": true, "internal-active": idx === 0}');
        assertScopeAcc("{name: $scope.wasProvidedWorkbook}", "{name: wasProvidedWorkbook}");
        assertScopeAcc("new RegExp(\"^[a-z]+$\")", "/^[a-z]+$/");
        // yes, that next one is pretty horrific. actually spotted that in the wild.
        assertScopeAcc("{true: 'glyphicon-chevron-up', false: 'glyphicon-chevron-down'}[$scope.showList]",
                       "{true:'glyphicon-chevron-up', false:'glyphicon-chevron-down'}[showList]");
        assertScopeAcc("!{entity: $scope.imported[0], selected: true}.entity.selectable", "!{entity: imported[0], selected: true}.entity.selectable");
        assertScopeAcc("{entity: $scope.imported[0], selected: true}.selected", "{entity: imported[0], selected: true}.selected");
        assertScopeAcc("{entity: $scope.imported[0], selected: true}.entity[$scope.col.field]", "{entity: imported[0], selected: true}.entity[col.field]")
    });
});
